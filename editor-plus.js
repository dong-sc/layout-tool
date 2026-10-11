/* Dong Tools: device-local editing, previews, reusable layouts and export.
   Both HTML clients share this layer. Original photos never leave the device. */
(() => {
  'use strict';
  const mobile = !!document.querySelector('#stage');
  const controlIds = ['preset','cw','ch','igPanels','carouselRatio','margin','gutter','scale','nocrop','keepOrder','bgMode','sigOn','sigText','sigFont','sigPos','sigSize','sigColor','sigOp','qual','dpi'];
  const clone = x => JSON.parse(JSON.stringify(x));
  const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
  const mode = mobile ? 'mobile' : 'desktop';
  const pageToolsOpen=new WeakSet();
  let brand = {background:'#ffffff',logo:'',logoOn:false,title:'',date:'',place:'',titleOn:false};
  let logoImg = null, selected = null, busy = false, restoring = false, pending = false;
  let history = [], historyAt = -1, saveTimer, draftPending = false, saveChain = Promise.resolve();
  let dialog, statusEl, saveStatusEl, bar, notice, draftAvailable = null;
  const assets = new Map();
  const storageKey = 'dong-layout-presets-v1';
  let library = {templates:[],brands:[]};
  try { library = JSON.parse(localStorage.getItem(storageKey)) || library; } catch (_) {}
  if(!Array.isArray(library.templates) || !Array.isArray(library.brands)) library = {templates:[],brands:[]};
  function status(text){ if(statusEl){statusEl.textContent=text;statusEl.title=text;statusEl.classList.toggle('lp-error',/失敗|無法|不足|未存/.test(text));}if(saveStatusEl)saveStatusEl.textContent=text; }
  function currentPage(){ return selected && pages.includes(selected.p) ? selected.p : pages[mobile ? Math.max(0,cur) : 0]; }
  function readControls(){
    const result = {};
    controlIds.forEach(id => { const el = document.getElementById(id); if(el) result[id] = el.type === 'checkbox' ? el.checked : el.value; });
    if(mobile){ result.preset = curPreset; result.igPanels = panels; }
    return result;
  }
  function writeControls(values){
    controlIds.forEach(id => { const el = document.getElementById(id); if(el && values[id] != null){ if(el.type === 'checkbox') el.checked = !!values[id]; else el.value = values[id]; } });
    if(mobile){
      curPreset = PRESETS[values.preset] || values.preset === 'igc' ? values.preset : 'ig45';
      panels = clamp(+values.igPanels || 3,2,20);
      document.querySelectorAll('.pill').forEach(el => el.classList.toggle('on',el.dataset.p === curPreset));
      $('#panelCtl').style.display = curPreset === 'igc' ? 'inline-flex' : 'none';
      $('#pCount').textContent = panels; updLbls();
    } else {
      $('#custSize').style.display = $('#preset').value === 'custom' ? 'inline-flex' : 'none';
      $('#igPanelsBox').style.display = $('#preset').value === 'igc' ? 'inline-flex' : 'none';
      $('#qualLbl').textContent = $('#qual').value + '%';
    }
    $('#sigOpLbl').textContent = $('#sigOp').value + '%';
  }
  function snapshot(){
    photos.forEach(ph => assets.set(ph.id,ph));
    return {version:1,mode,controls:readControls(),pages:clone(pages),ids:photos.map(ph => ph.id),nextId,brand:clone(brand)};
  }
  function fingerprint(s){ return JSON.stringify(s); }
  function capture(){
    if(restoring || busy) return;
    const state = snapshot(), key = fingerprint(state);
    if(history[historyAt]?.key === key) return;
    history.splice(historyAt+1); history.push({state,key});
    if(history.length > 40) history.shift();
    historyAt = history.length-1;
    updateHistoryButtons(); scheduleSave();
  }
  function changed(){
    if(pending || restoring || busy) return;
    pending = true;
    queueMicrotask(() => { pending = false; capture(); });
  }
  function updateHistoryButtons(){
    if(!bar) return;
    bar.querySelector('[data-action=undo]').disabled = historyAt <= 0 || busy;
    bar.querySelector('[data-action=redo]').disabled = historyAt >= history.length-1 || busy;
  }
  async function loadLogo(){
    logoImg = null;
    if(!brand.logo) return;
    const source = brand.logo, img = new Image(); img.src = source;
    try { await img.decode(); if(brand.logo === source) logoImg = img; } catch (_) { status('Logo 無法載入，請重新選擇'); }
  }
  function restoreState(state,keepView=false){
    const wrap=!mobile?$('#pagesWrap'):null,scroll=keepView&&wrap?{left:wrap.scrollLeft,top:wrap.scrollTop}:null;
    restoring = true;
    try {
      if(dialog?.open)dialog.close();
      selected = null; panning = null;
      if(mobile){closeSheets();if(!keepView){cur=0;resetView();}swapFrom=null;} else {selCell=null;ptr=null;dragData=null;}
      writeControls(state.controls);
      pages = clone(state.pages);
      photos = state.ids.map(id => assets.get(id)).filter(Boolean);
      nextId = Math.max(state.nextId || 1,...photos.map(ph => ph.id+1));
      brand = clone(state.brand || brand);
      // Existing cells are part of the snapshot: do not regenerate candidate trees on undo.
      if(mobile)cur=Math.max(0,Math.min(cur,pages.length-1));
      render();if(scroll){wrap.scrollLeft=scroll.left;wrap.scrollTop=scroll.top;}loadLogo().then(() => decorate());
    } finally { restoring = false; }
  }
  function undo(delta){
    if(busy) return;
    capture(); const at = historyAt+delta;
    if(at < 0 || at >= history.length) return;
    historyAt = at; restoreState(history[at].state,true); updateHistoryButtons(); scheduleSave();
  }
  function openDB(){
    return new Promise((resolve,reject) => {
      const request = indexedDB.open('dong-layout-local-v1',1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
  async function dbOperation(action,value){
    const db = await openDB();
    try { return await new Promise((resolve,reject) => {
      const tx = db.transaction('drafts',action === 'get' ? 'readonly':'readwrite');
      const store = tx.objectStore('drafts');
      const req = action === 'get' ? store.get(mode) : action === 'put' ? store.put(value,mode) : store.delete(mode);
      tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('儲存已中止'));
    }); } finally { db.close(); }
  }
  function scheduleSave(){
    if(!photos.length && !pages.length && !draftPending) return;
    draftPending = true; status('草稿待儲存'); clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft,900);
  }
  function saveDraft(){
    if(busy || restoring){scheduleSave();return saveChain;}
    const state = snapshot(), key = fingerprint(state);
    const files = photos.map(ph => ({id:ph.id,file:ph.file,name:ph.file.name}));
    status('儲存草稿中…');
    saveChain = saveChain.catch(()=>{}).then(() => dbOperation('put',{state,files,savedAt:Date.now()})).then(() => {
      if(fingerprint(snapshot()) === key){draftPending=false;status('草稿已存於此裝置');}
    }).catch(() => {draftPending=true;status('草稿未存成功，請下載專案備份');});
    return saveChain;
  }
  async function importAssets(records){
    const imported = [];
    for(const rec of records){
      const file = rec.file instanceof File ? rec.file : new File([rec.file],rec.name || '照片.jpg',{type:rec.file.type});
      const bmp = await decodeFile(file), s = Math.min(1,PREVIEW_PX/Math.max(bmp.width,bmp.height));
      const cv = document.createElement('canvas'); cv.width = Math.max(1,Math.round(bmp.width*s)); cv.height = Math.max(1,Math.round(bmp.height*s));
      const w=bmp.width,h=bmp.height; cv.getContext('2d').drawImage(bmp,0,0,cv.width,cv.height);bmp.close();
      const blob = await jpegBlob(cv,.85), url = URL.createObjectURL(blob), img = new Image(); img.src=url;await img.decode();
      cv.width=0;cv.height=0;
      imported.push({id:rec.id,file,url,img,w,h,ar:w/h,sel:false});
    }
    return imported;
  }
  async function restoreDraft(data){
    if(busy) return;
    busy=true;showOverlay('載入草稿…',0);
    try {
      const imported = await importAssets(data.files);
      assets.forEach(ph=>URL.revokeObjectURL(ph.url));assets.clear();imported.forEach(ph => assets.set(ph.id,ph));
      restoreState(data.state); history=[];historyAt=-1;
      if(notice) notice.hidden=true;
      status('草稿已恢復');flowStep=pages.length?2:1;flowKey='';syncFlow();
    } catch(e){alert('草稿載入失敗：'+e.message);} finally {busy=false;hideOverlay();capture();}
  }
  function persistLibrary(){
    try { localStorage.setItem(storageKey,JSON.stringify(library)); }
    catch (_){alert('設定未存成功，裝置空間可能不足。請下載專案備份。');}
  }
  function node(tag,text,cls){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;}
  function button(text,fn,parent){const b=node('button',text);b.type='button';b.onclick=fn;if(parent)parent.appendChild(b);return b;}
  function openDialog(title){
    saveStatusEl=null;dialog.classList.remove('lp-review-dialog');
    const sameView=dialog.dataset.view===title,expanded=sameView?[...dialog.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent):[];
    dialog._expanded=expanded;dialog._sameView=sameView;dialog.dataset.view=title;dialog.onkeydown=null;dialog.scrollTop=0;
    dialog.replaceChildren();const close=button('關閉',()=>dialog.close(),dialog);close.className='lp-close';
    dialog.appendChild(node('h2',title));dialog.setAttribute('aria-label',title);if(!dialog.open)dialog.showModal();return dialog;
  }
  function row(parent=dialog){const el=node('div',null,'lp-row');parent.appendChild(el);return el;}
  function section(title,parent=dialog,expanded=false){
    const el=node('details',null,'lp-section');el.open=dialog._sameView?dialog._expanded.includes(title):expanded;el.appendChild(node('summary',title));parent.appendChild(el);return el;
  }
  function windowRange(total,index,size=8){const start=Math.floor(Math.max(0,index)/size)*size;return {start,end:Math.min(total,start+size)};}
  function field(parent,label,value,type='text',onchange){
    const lab=node('label',label), input=node('input');input.type=type;
    if(type==='checkbox')input.checked=!!value;else input.value=value;
    input.onchange=()=>onchange?.(type==='checkbox'?input.checked:input.value);
    lab.appendChild(input);parent.appendChild(lab);return input;
  }
  function pageChooser(parent,onchange){
    const lab=node('label','編輯組別 '), sel=node('select');
    pages.forEach((p,i)=>{const opt=node('option',`第 ${i+1} 組 · ${allIds(p).length} 張`);opt.value=i;sel.appendChild(opt);});
    sel.value=Math.max(0,pages.indexOf(currentPage()));sel.onchange=()=>onchange(pages[+sel.value]);lab.appendChild(sel);parent.appendChild(lab);return sel;
  }
  function cells(p){
    if(p.freeMode) return Object.entries(p.free || {}).map(([id,r])=>({id:+id,rect:r,z:r.z||0})).filter(c=>allIds(p).includes(c.id)).sort((a,b)=>a.z-b.z);
    return Object.entries(p.cells).map(([id,r])=>({id:+id,rect:mobile?drawRect(id,r):drawRect(p,id,r),z:0}));
  }
  function ensureFree(p){
    if(p.freeMode) return;
    p.free = {}; cells(p).forEach(({id,rect},i)=>p.free[id]={...rect,z:i+1});p.freeMode=true;
    const st=settings();p._plusSize={w:st.w,h:st.h};
    p.layoutLocks??={};p.regions.forEach(r=>{if(r.locked)r.photoIds.forEach(id=>p.layoutLocks[id]=true);r.locked=false;});
  }
  function isLocked(p,id){const reg=findRegion(p,id);return !!(p.layoutLocks?.[id] || reg?.locked);}
  function focalOffset(ar,cellAR,focus,z=1){
    const W=ar,H=1,sw=(ar>cellAR?cellAR:ar)/z,sh=sw/cellAR;
    return {ox:W-sw>1e-9?clamp((focus.x*W-sw/2)/(W-sw)):.5,oy:H-sh>1e-9?clamp((focus.y*H-sh/2)/(H-sh)):.5,z};
  }
  function applyFocus(p){
    for(const {id,rect} of cells(p)){
      const focus=p.focus?.[id];if(!focus || p.cropLocks?.[id])continue;
      const ar=rect.w/rect.h, old=getOffset(p,id), key=ar.toFixed(7)+':'+(old.z||1);
      if(focus.last === key) continue;
      p.offsets[id]=focalOffset(photoById(id).ar,ar,focus,old.z||1);focus.last=key;
    }
  }
  const baseCompute=computeCells;
  computeCells=function(p){
    const st=settings(), old=p._plusSize;
    if(p.freeMode && old && (old.w!==st.w || old.h!==st.h)){
      for(const f of Object.values(p.free || {})){f.x*=st.w/old.w;f.w*=st.w/old.w;f.y*=st.h/old.h;f.h*=st.h/old.h;}
    }
    const oldCount=p.regions.length; baseCompute(p);
    if(oldCount!==p.regions.length){p.layoutLocks={};}
    p._plusSize={w:st.w,h:st.h};applyFocus(p);
  };
  const baseRelayout=relayoutRegion;
  relayoutRegion=function(p,reg,k){ if(reg.locked && reg.cands?.length)return; baseRelayout(p,reg,k); };
  function regionShuffle(p,k){
    const reg=p.regions[k];if(!reg || reg.locked || p.freeMode)return;
    if(reg.cands.length<2)baseRelayout(p,reg,k);
    if(reg.cands.length)reg.candIdx=(reg.candIdx+1)%reg.cands.length;
    computeCells(p);
  }
  if(!mobile){
    shuffleRegion=regionShuffle;
    shufflePage=function(p){p.regions.forEach((r,k)=>regionShuffle(p,k));};
    const baseSwap=swapPhotos,baseMove=movePhotoToPage,baseRemove=removePhotoFromPage;
    swapPhotos=function(p,a,b){if(isLocked(p,a)||isLocked(p,b))return;return baseSwap(p,a,b);};
    movePhotoToPage=function(id,p,k){const src=pages.find(p=>allIds(p).includes(+id));if((src&&isLocked(src,id))||p.regions[k||0]?.locked)return;const result=baseMove(id,p,k);if(p.freeMode&&!p.free[id]){const r=regionRects()[k||0]||{x:0,y:0,w:settings().w,h:settings().h};const slot=p.cells[id]||containRect({x:r.x+r.w*.2,y:r.y+r.h*.2,w:r.w*.6,h:r.h*.6},photoById(id).ar);p.free[id]={...slot,z:Math.max(0,...Object.values(p.free).map(f=>f.z||0))+1};}return result;};
    removePhotoFromPage=function(p,id){if(isLocked(p,id))return;return baseRemove(p,id);};
    const basePan=startPanDrag;
    startPanDrag=function(e,el,p,id,...args){if(p.cropLocks?.[id])return;return basePan(e,el,p,id,...args);};
    const basePointer=handlePointerMove;
    handlePointerMove=function(e,st){if(ptr && ptr.mode!=='pan' && isLocked(ptr.p,ptr.id))return;return basePointer(e,st);};
    const baseFree=toggleFree;
    toggleFree=function(p){if(p.freeMode && Object.values(p.layoutLocks||{}).some(Boolean)){alert('請先解除照片位置鎖定，再切回自動排版。');return;}const entering=!p.freeMode;baseFree(p);if(entering){const st=settings();p._plusSize={w:st.w,h:st.h};p.layoutLocks??={};p.regions.forEach(r=>{if(r.locked)r.photoIds.forEach(id=>p.layoutLocks[id]=true);r.locked=false;});render();}};
  }else{
    const baseSwap=doSwap;doSwap=function(p,a,b){if(isLocked(p,a)||isLocked(p,b))return;if(p.freeMode){[p.free[a],p.free[b]]=[p.free[b],p.free[a]];return;}return baseSwap(p,a,b);};
    const basePan=startPan;startPan=function(e,el,p,id){if(p.cropLocks?.[id])return;return basePan(e,el,p,id);};
    $('#shuffleBtn').onclick=()=>{const p=pages[cur];p.regions.forEach((r,k)=>regionShuffle(p,k));render();};
    for(const key of ['opStar','opRemove']){
      const original=$('#'+key).onclick;
      $('#'+key).onclick=()=>{if(isLocked(pages[cur],sheetPhoto)){alert('請先解除這格的排版鎖定。');return;}original();};
    }
  }
  function background(bgm){return bgm==='brand'?brand.background:bgm==='white'?'#fff':'#000';}
  function drawExtras(ctx,scale,st,n){
    const pw=st.w/n, h=st.h;
    ctx.save();
    if(brand.logoOn && logoImg){
      const w=pw*.15, lh=Math.min(h*.12,w/logoImg.naturalWidth*logoImg.naturalHeight);
      const lw=lh*logoImg.naturalWidth/logoImg.naturalHeight;
      for(let k=0;k<n;k++)ctx.drawImage(logoImg,(k*pw+pw*.05)*scale,(h-h*.05-lh)*scale,lw*scale,lh*scale);
    }
    if(brand.titleOn){
      const lines=[brand.title,[brand.date,brand.place].filter(Boolean).join(' · ')].filter(Boolean);
      const fs=pw*.036*scale, x=pw*.05*scale,y=h*.05*scale;
      if(lines.length){
        ctx.font=`${fs}px ${SIG_FONTS.sans}`;
        const maxW=pw*.8*scale;
        ctx.fillStyle='rgba(0,0,0,.62)';ctx.fillRect(x-fs*.4,y-fs*.3,maxW+fs*.8,lines.length*fs*1.6+fs*.5);
        ctx.fillStyle='#fff';ctx.textBaseline='top';lines.forEach((text,i)=>ctx.fillText(text,x,y+i*fs*1.6,maxW));
      }
    }
    ctx.restore();
  }
  const baseSig=drawSigOn;
  drawSigOn=function(ctx,scale,st,n){baseSig(ctx,scale,st,n);drawExtras(ctx,scale,st,n||1);};
  async function paintTile(p,k,options={}){
    const st=options.st||settings(),ig=igMeta(),n=options.panels||ig?.panels||1;
    const width=options.width||540,height=Math.round(width*st.h/(st.w/n)),scale=width/(st.w/n);
    const cv=document.createElement('canvas');cv.width=width;cv.height=height;const ctx=cv.getContext('2d');
    ctx.translate(-k*width,0);
    const bgm=mobile?$('#bgMode').value:bgModeOf(p);
    ctx.fillStyle=background(bgm);ctx.fillRect(0,0,width*n,height);
    if(bgm==='blur'){const ph=bgPhotoOf(p);if(ph)blurDraw(ctx,ph,width*n,height);}
    for(const {id,rect:r} of cells(p)){
      if(r.x+r.w<=k*st.w/n || r.x>=(k+1)*st.w/n)continue;
      const ph=photoById(id),off=getOffset(p,id);
      if(options.original){
        const part=await cropCanvas(ph,r.w/r.h,r.w*scale,off.ox,off.oy,off.z);
        ctx.drawImage(part,r.x*scale,r.y*scale,r.w*scale,r.h*scale);part.width=0;part.height=0;
      }else{
        const W=ph.img.naturalWidth,H=ph.img.naturalHeight,ar=W/H,z=off.z||1;
        const sw=(ar>r.w/r.h?H*r.w/r.h:W)/z,sh=sw/(r.w/r.h);
        ctx.drawImage(ph.img,(W-sw)*off.ox,(H-sh)*off.oy,sw,sh,r.x*scale,r.y*scale,r.w*scale,r.h*scale);
      }
    }
    drawSigOn(ctx,scale,st,n);return cv;
  }
  function seamWarning(p,k){
    const st=settings(),n=igMeta()?.panels||1,pw=st.w/n, messages=[];
    for(const {id,rect:r} of cells(p)){
      const focus=p.focus?.[id];if(!focus)continue;
      const ph=photoById(id),off=getOffset(p,id),sw=(ph.ar>r.w/r.h?r.w/r.h:ph.ar)/(off.z||1),sh=sw/(r.w/r.h);
      const x=r.x+(focus.x*ph.ar-(ph.ar-sw)*off.ox)/sw*r.w;
      if(x>=k*pw && x<=(k+1)*pw && (Math.abs(x-k*pw)<pw*.04 || Math.abs(x-(k+1)*pw)<pw*.04))messages.push('構圖重點靠近切頁邊緣');
    }
    if(!cells(p).some(({rect:r})=>r.x<(k+1)*pw&&r.x+r.w>k*pw))messages.push('這張沒有照片');
    return [...new Set(messages)].join(' · ');
  }
  async function preview(){
    if(!pages.length)return;
    openDialog('輪播預覽');
    const stage=node('div',null,'lp-preview-stage'), label=node('p'),strip=node('div',null,'lp-preview-strip');
    const navigation=row();
    dialog.append(stage,label,strip);const actions=row();
    const slides=pages.flatMap((p,i)=>Array.from({length:igMeta()?.panels||1},(_,k)=>({p,i,k})));
    let at=Math.max(0,slides.findIndex(s=>s.p===currentPage())), token=0;
    const show=async index=>{
      at=clamp(index,0,slides.length-1);const mine=++token,s=slides[at];
      const cv=await paintTile(s.p,s.k,{width:720});if(mine!==token||!dialog.open)return;
      stage.replaceChildren(cv);label.textContent=`第 ${s.i+1} 組 · 第 ${s.k+1} 張 / ${igMeta()?.panels||1} 張　${seamWarning(s.p,s.k)}`;
      strip.replaceChildren();const range=windowRange(slides.length,at);
      for(let i=range.start;i<range.end;i++){const slide=slides[i],b=button(`${slide.i+1}－${slide.k+1}`,()=>show(i),strip);b.setAttribute('aria-current',i===at);}
      previous.disabled=at===0;next.disabled=at===slides.length-1;jump.value=at+1;group.value=s.i;
    };
    const group=pageChooser(navigation,p=>show(slides.findIndex(s=>s.p===p)));
    const jump=field(navigation,'跳至',at+1,'number',v=>show(Math.round(+v||1)-1));jump.min=1;jump.max=slides.length;
    navigation.appendChild(node('span',`／共 ${slides.length} 張`,'lp-count'));
    const previous=button('上一張',()=>show(at-1),actions),next=button('下一張',()=>show(at+1),actions);
    button('到這張編輯',()=>{
      const s=slides[at];selected={p:s.p,id:allIds(s.p)[0]};dialog.close();setStep(2);
      if(mobile){cur=s.i;resetView();render();const n=igMeta()?.panels||1;view.s=Math.min(8,n);view.tx=(n/2-s.k-.5)*$('#cv').clientWidth/n*view.s;applyView();}
      else {const el=$('#pageblock-'+s.i),wrap=$('#pagesWrap');el.scrollIntoView({block:'start'});wrap.scrollLeft=s.k*el.clientWidth/(igMeta()?.panels||1);}
    },actions);
    let sx=0;stage.onpointerdown=e=>sx=e.clientX;stage.onpointerup=e=>{if(Math.abs(e.clientX-sx)>40)show(at+(e.clientX<sx?1:-1));};
    dialog.onkeydown=e=>{if(e.key==='ArrowRight'){e.preventDefault();show(at+1);}if(e.key==='ArrowLeft'){e.preventDefault();show(at-1);}};
    show(at);
  }
  function replacePhoto(p,id,replacement){
    if(isLocked(p,id)||!photoById(replacement)||pages.some(page=>allIds(page).includes(replacement)))return;
    ensureFree(p);const reg=findRegion(p,id),slot=p.free[id];if(!reg||!slot)return;
    reg.photoIds[reg.photoIds.indexOf(id)]=replacement;reg.stars=reg.stars.map(pid=>pid===id?replacement:pid);
    p.free[replacement]={...slot};delete p.free[id];delete p.offsets[id];p.offsets[replacement]={ox:.5,oy:.5,z:1};
    for(const key of ['focus','reviews','cropLocks','layoutLocks'])if(p[key]){delete p[key][id];delete p[key][replacement];}
    if(p.bgPhoto===id)p.bgPhoto=replacement;photoById(id).sel=false;photoById(replacement).sel=false;
    selected={p,id:replacement};render();editing();
  }
  function replacementPicker(p,id,index=0){
    openDialog('替換照片，保留目前位置');
    const used=new Set(pages.flatMap(allIds)),unused=photos.filter(ph=>!used.has(ph.id));
    dialog.appendChild(node('p','選取照片池中的照片替換這張。沿用所有照片的位置，轉為自由編排；新照片需重新確認裁切。'));
    if(!unused.length){dialog.appendChild(node('p','照片池沒有未使用照片。可先關閉這裡，再按「加入照片」。'));return;}
    const range=windowRange(unused.length,index),navigation=row();
    button('上一批',()=>replacementPicker(p,id,Math.max(0,range.start-8)),navigation).disabled=range.start===0;
    const jump=field(navigation,'跳至照片',index+1,'number',v=>replacementPicker(p,id,clamp(Math.round(+v||1)-1,0,unused.length-1)));jump.min=1;jump.max=unused.length;
    button('下一批',()=>replacementPicker(p,id,range.end),navigation).disabled=range.end===unused.length;
    const list=node('div',null,'lp-photo-list');dialog.appendChild(list);
    for(let i=range.start;i<range.end;i++){const ph=unused[i],b=button(String(i+1),()=>replacePhoto(p,id,ph.id),list),im=node('img');im.src=ph.url;im.alt=ph.file.name;b.title=ph.file.name;b.prepend(im);}
  }
  function editing(){
    if(!pages.length)return;
    openDialog('調整照片');const p=currentPage(),ids=allIds(p);
    let id=selected?.p===p&&ids.includes(selected.id)?selected.id:ids[0];
    const controls=row();pageChooser(controls,next=>{selected={p:next,id:allIds(next)[0]};editing();});
    if(!id){dialog.appendChild(node('p','這組尚未放入照片。'));return;}selected={p,id};
    const at=ids.indexOf(id),range=windowRange(ids.length,at),picker=row();
    const choose=index=>{selected={p,id:ids[clamp(index,0,ids.length-1)]};editing();};
    button('上一張',()=>choose(at-1),picker).disabled=at===0;
    const jump=field(picker,'照片',at+1,'number',v=>choose(Math.round(+v||1)-1));jump.min=1;jump.max=ids.length;
    picker.appendChild(node('span',`／${ids.length} 張`,'lp-count'));
    button('下一張',()=>choose(at+1),picker).disabled=at===ids.length-1;
    const photoList=node('div',null,'lp-photo-list');dialog.appendChild(photoList);
    for(let i=range.start;i<range.end;i++){const pid=ids[i],ph=photoById(pid),b=button(String(i+1),()=>choose(i),photoList),im=node('img');im.src=ph.url;im.alt='';im.loading='lazy';b.title=ph.file.name;b.setAttribute('aria-label',`第 ${i+1} 張：${ph.file.name}`);b.setAttribute('aria-pressed',pid===id);b.prepend(im);}
    const filename=node('p',photoById(id).file.name,'lp-filename');filename.title=photoById(id).file.name;dialog.appendChild(filename);
    const reg=findRegion(p,id),basic=section('位置與裁切',dialog,true),lockRow=row(basic);button('替換照片，保留位置',()=>replacementPicker(p,id),row(basic)).disabled=isLocked(p,id);
    field(lockRow,p.freeMode?'固定照片位置':'固定這格排法',isLocked(p,id),'checkbox',value=>{
      if(p.freeMode){p.layoutLocks??={};p.layoutLocks[id]=value;}else reg.locked=value;
      render();editing();
    });
    field(lockRow,'固定裁切',!!p.cropLocks?.[id],'checkbox',value=>{p.cropLocks??={};p.cropLocks[id]=value;render();});
    if(!p.freeMode&&reg){const k=p.regions.indexOf(reg);button(`更換第 ${k+1} 格排法`,()=>{regionShuffle(p,k);render();editing();},row(basic)).disabled=reg.locked;}
    const focusRow=row(basic);button('標記構圖重點',()=>focusEditor(p,id),focusRow);
    if(p.focus?.[id])button('移除標記',()=>{delete p.focus[id];render();editing();},focusRow);
    basic.appendChild(node('p','換版型時，優先保留標記的位置。'));
    const n=igMeta()?.panels||1;
    if(n>1){const spread=section('跨頁照片'),ar=row(spread);
      spread.appendChild(node('p','將這張照片放大，橫跨連續頁面；可能蓋住原有照片。'));
      const start=field(ar,'起始頁',Math.min(n,Math.floor((cells(p).find(c=>c.id===id)?.rect.x||0)/(settings().w/n))+1),'number');start.min=1;start.max=n;
      for(const span of [2,3]){const b=button(`跨 ${span} 頁`,()=>{spanPhoto(p,id,+start.value-1,span);editing();},ar);b.disabled=n<span||isLocked(p,id);}
    }
    const precision=section('自由編排與精確位置');
    button(p.freeMode?'回到自動排版':'啟用自由編排',()=>{
      if(p.freeMode){if(Object.values(p.layoutLocks||{}).some(Boolean)){alert('請先解除位置鎖定。');return;}p.freeMode=false;computeCells(p);}
      else ensureFree(p);render();editing();
    },row(precision));
    if(p.freeMode){
      precision.appendChild(node('p',mobile?'拖動照片調整位置，拖右下角調整大小。':'在畫布上拖動照片，或輸入精確位置。'));
      const f=p.free[id],geometry=row(precision);
      if(f)for(const [key,label] of [['x','左右 %'],['y','上下 %'],['w','寬度 %'],['h','高度 %']]){
        const dimension=key==='x'||key==='w'?settings().w:settings().h;
        const input=field(geometry,label,+(f[key]/dimension*100).toFixed(1),'number',v=>{
          if(isLocked(p,id))return;const val=+v;if(!Number.isFinite(val))return;
          f[key]=(key==='w'||key==='h'?Math.max(1,val):val)/100*dimension;applyFocus(p);render();
        });input.step=.5;input.disabled=isLocked(p,id);
      }
      if(f)button('移到最上層',()=>{f.z=Math.max(...Object.values(p.free).map(f=>f.z||0))+1;render();},geometry);
    }
  }
  function spanPhoto(p,id,start,span){
    const n=igMeta()?.panels||1;if(n<span || isLocked(p,id))return;
    const st=settings(),pw=st.w/n;ensureFree(p);
    start=clamp(Math.round(start)||0,0,n-span);
    const z=Math.max(...Object.values(p.free).map(f=>f.z||0))+1;
    p.free[id]={x:start*pw,y:0,w:pw*span,h:st.h,z};p._plusSize={w:st.w,h:st.h};
    // Once in free mode, region layout locks become per-photo position locks.
    p.layoutLocks??={};p.regions.forEach(r=>{if(r.locked)r.photoIds.forEach(pid=>p.layoutLocks[pid]=true);});
    applyFocus(p);render();
  }
  function focusEditor(p,id){
    openDialog('點選要保留在畫面內的位置');
    const ph=photoById(id),wrap=node('div',null,'lp-focus-photo'),im=node('img'),dot=node('span',null,'lp-focus-dot');im.src=ph.url;
    wrap.append(im,dot);dialog.append(wrap,node('p','點照片設定構圖重點。它會盡量維持在裁切窗中央；不會改動原始照片。'));
    const show=()=>{const f=p.focus?.[id];dot.hidden=!f;if(f){dot.style.left=f.x*100+'%';dot.style.top=f.y*100+'%';}};
    wrap.onclick=e=>{const r=im.getBoundingClientRect();p.focus??={};p.focus[id]={x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height)};if(p.cropLocks?.[id]){status('已記錄構圖重點；裁切已鎖定');}else applyFocus(p);render();show();};
    button('完成',editing,row());show();
  }
  async function candidates(p=currentPage()){
    if(!p)return;openDialog('比較版型');
    if(p.freeMode){dialog.appendChild(node('p','目前為自由編排，請先回到自動排版，再比較候選版型。'));return;}
    const choices=[],seen=new Set();
    for(let step=0;step<60 && choices.length<4;step++){
      const q=clone(p);q.regions.forEach(r=>{if(!r.locked&&r.cands.length)r.candIdx=(r.candIdx+step)%r.cands.length;});computeCells(q);
      const key=JSON.stringify(q.cells);if(!seen.has(key)){seen.add(key);choices.push(q);}
    }
    const grid=node('div',null,'lp-grid');dialog.appendChild(grid);
    // Summaries use one tile per carousel region so a long carousel remains legible.
    for(let i=0;i<choices.length;i++){
      const choice=choices[i],b=button(i===0?'保留目前版型':`採用版型 ${i+1}`,()=>{Object.assign(p,clone(choice));render();dialog.close();},grid);b.className='lp-candidate';
      const n=igMeta()?.panels||1,cv=document.createElement('canvas'),w=Math.min(n,5)*160,h=Math.round(160*settings().h/(settings().w/n));cv.width=w;cv.height=h;const ctx=cv.getContext('2d');
      for(let k=0;k<Math.min(n,5);k++){const tile=await paintTile(choice,k,{width:160});ctx.drawImage(tile,k*160,0);tile.width=0;tile.height=0;}b.prepend(cv);
    }
    dialog.appendChild(node('p',choices.length<4?'依照片張數與鎖定狀態，目前可用的不同版型較少。':'已鎖定的格子會保持原樣。輪播縮圖顯示前五張，可採用後開啟完整預覽。'));
  }
  function saveTemplate(name,p){
    const st=settings(),ids=allIds(p),currentCells=cells(p);
    return {name,controls:readControls(),slots:ids.map(id=>{const rect=currentCells.find(c=>c.id===id).rect;return {x:rect.x/st.w,y:rect.y/st.h,w:rect.w/st.w,h:rect.h/st.h,z:rect.z||0,offset:getOffset(p,id),cropLock:!!p.cropLocks?.[id],focus:p.focus?.[id]?{x:p.focus[id].x,y:p.focus[id].y}:null};}),count:ids.length};
  }
  function applyTemplate(t,p){
    const ids=allIds(p);if(ids.length!==t.count){alert(`此版型需要 ${t.count} 張照片，目前這組有 ${ids.length} 張。`);return false;}
    writeControls(t.controls);pages.forEach(computeCells);const st=settings();
    p.freeMode=true;p.free={};p.cropLocks={};p.layoutLocks={};p.focus={};p.regions.forEach(r=>r.locked=false);
    t.slots.forEach((s,i)=>{const id=ids[i];p.free[id]={x:s.x*st.w,y:s.y*st.h,w:s.w*st.w,h:s.h*st.h,z:s.z||i+1};p.offsets[id]={...s.offset};p.cropLocks[id]=s.cropLock;if(s.focus)p.focus[id]={...s.focus};});
    p._plusSize={w:st.w,h:st.h};applyFocus(p);render();return true;
  }
  function templates(){
    openDialog('我的版型');dialog.appendChild(node('p','依照片順序套用，需使用相同張數。'));
    const help=section('版型會保存哪些設定？');help.appendChild(node('p','保存位置、裁切、留白與比例，不含照片。套用版型會一併更新所有組別的比例與全域設定。'));
    const r=row(),name=field(r,'名稱','','text');
    button('儲存目前這組',()=>{const p=currentPage();if(!p)return;if(!name.value.trim()){name.focus();return;}library.templates.push(saveTemplate(name.value.trim(),p));persistLibrary();templates();},r).disabled=!pages.length;
    for(const t of library.templates){const r=row();r.appendChild(node('span',`${t.name} · ${t.count} 張`));button('套用',()=>{const p=currentPage();if(p&&applyTemplate(t,p))dialog.close();},r).disabled=!pages.length;button('刪除',()=>{library.templates=library.templates.filter(x=>x!==t);persistLibrary();templates();},r);}
    const io=row();button('匯出版型',()=>triggerDownload(new Blob([JSON.stringify({version:1,templates:library.templates})],{type:'application/json'}),'我的版型.json'),io);
    button('匯入版型',()=>pickFile('.json',async file=>{const data=JSON.parse(await file.text());validateTemplates(data);library.templates.push(...data.templates);persistLibrary();templates();}),io);
  }
  function validateTemplates(data){
    if(data.version!==1||!Array.isArray(data.templates)||data.templates.length>100)throw new Error('版型檔格式不正確');
    for(const t of data.templates){if(typeof t.name!=='string'||!Array.isArray(t.slots)||t.slots.length!==t.count||t.count<1||t.count>200||!t.controls)throw new Error('版型內容不完整');for(const s of t.slots)for(const key of ['x','y','w','h'])if(!Number.isFinite(s[key])||Math.abs(s[key])>10||(key==='w'||key==='h')&&s[key]<=0)throw new Error('版型位置無效');}
  }
  function brandEditor(){
    openDialog('品牌與作品資訊');
    const identity=section('署名與 Logo',dialog,true),appearance=section('背景色'),info=section('首張作品資訊'),presets=section('品牌預設');
    const r=row(appearance);field(r,'品牌背景色',brand.background,'color',v=>{brand.background=v;render();});
    button('使用品牌背景',()=>{$('#bgMode').value='brand';render();},r);
    const sig=row(identity);field(sig,'署名文字',$('#sigText').value,'text',v=>{$('#sigText').value=v;render();});field(sig,'顯示署名',$('#sigOn').checked,'checkbox',v=>{$('#sigOn').checked=v;render();});
    const lr=row(identity);field(lr,'顯示 Logo',brand.logoOn,'checkbox',v=>{brand.logoOn=v;render();});
    button('選擇 Logo',()=>pickFile('image/png,image/jpeg,image/webp',async file=>{
      if(file.size>2*1024*1024)throw new Error('Logo 請使用 2 MB 以下的 PNG／JPEG／WebP');
      brand.logo=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      brand.logoOn=true;await loadLogo();render();brandEditor();
    }),lr);
    button('移除 Logo',()=>{brand.logo='';brand.logoOn=false;logoImg=null;render();brandEditor();},lr);
    const tr=row(info);field(tr,'首張作品資訊',brand.titleOn,'checkbox',v=>{brand.titleOn=v;render();});
    field(row(info),'作品／活動名稱',brand.title,'text',v=>{brand.title=v;render();});field(row(info),'日期',brand.date,'text',v=>{brand.date=v;render();});field(row(info),'地點',brand.place,'text',v=>{brand.place=v;render();});
    const pr=row(presets),name=field(pr,'預設名稱','','text');
    button('儲存品牌預設',()=>{if(!name.value.trim())return;const controls=readControls();library.brands.push({name:name.value.trim(),brand:{...brand,title:'',date:'',place:'',titleOn:false},controls:Object.fromEntries(Object.entries(controls).filter(([id])=>id.startsWith('sig')||id==='bgMode'))});persistLibrary();brandEditor();},pr);
    library.brands.forEach(b=>{const r=row(presets);r.appendChild(node('span',b.name));button('套用',async()=>{brand={...brand,...b.brand};writeControls({...readControls(),...b.controls});await loadLogo();render();brandEditor();},r);button('刪除',()=>{library.brands=library.brands.filter(x=>x!==b);persistLibrary();brandEditor();},r);});
    dialog.appendChild(node('p','Logo 放在每張左下角；作品資訊顯示於每組首張左上角。請用預覽確認不遮住重要內容。'));
  }
  function pickFile(accept,callback){
    const input=node('input');input.type='file';input.accept=accept;
    input.onchange=async()=>{if(!input.files[0])return;try{await callback(input.files[0]);}catch(e){alert('載入失敗：'+e.message);}};input.click();
  }
  function validateProject(data,files){
    if(data.version!==1||!Array.isArray(data.pages)||!Array.isArray(data.ids)||data.ids.length>1000||!data.controls)throw new Error('專案檔格式不正確');
    const ids=new Set(data.ids);if(ids.size!==data.ids.length||files.length!==ids.size||new Set(files.map(f=>f.id)).size!==ids.size||files.some(f=>!ids.has(f.id)))throw new Error('照片資料不完整');
    for(const p of data.pages){if(!Array.isArray(p.regions)||!p.offsets||!p.cells)throw new Error('頁面資料不完整');for(const id of allIds(p))if(!ids.has(id))throw new Error('頁面照片遺失');}
  }
  async function exportProject(){
    if(!photos.length||busy)return;if(dialog?.open)dialog.close();busy=true;showOverlay('打包本機專案…',0);
    try {const zip=new JSZip(),state=snapshot();zip.file('project.json',JSON.stringify(state));const manifest=[];
      for(const ph of photos){const path='photos/'+ph.id;zip.file(path,ph.file);manifest.push({id:ph.id,path,name:ph.file.name,type:ph.file.type});}
      zip.file('photos.json',JSON.stringify(manifest));triggerDownload(await zip.generateAsync({type:'blob'}),'排版專案.dong.zip');
    }catch(e){alert('專案備份失敗：'+e.message);}finally{busy=false;hideOverlay();updateHistoryButtons();}
  }
  async function importProject(file){
    if(busy)return;busy=true;showOverlay('讀取排版專案…',0);
    try {
      if(file.size>500*1024*1024)throw new Error('專案檔過大，請控制在 500 MB 以下');
      const zip=await JSZip.loadAsync(file);if(!zip.file('project.json')||!zip.file('photos.json'))throw new Error('不是排版專案檔');
      const state=JSON.parse(await zip.file('project.json').async('string')),records=JSON.parse(await zip.file('photos.json').async('string'));
      if(!Array.isArray(records)||records.length>1000)throw new Error('照片清單無效');validateProject(state,records);
      let bytes=0;const files=[];
      for(const r of records){const entry=zip.file(r.path);if(!entry)throw new Error('專案缺少照片');const blob=await entry.async('blob');bytes+=blob.size;if(bytes>500*1024*1024)throw new Error('解壓縮照片過大');files.push({id:r.id,file:new File([blob],r.name,{type:r.type})});}
      const imported=await importAssets(files);assets.forEach(ph=>URL.revokeObjectURL(ph.url));assets.clear();imported.forEach(ph=>assets.set(ph.id,ph));restoreState(state);history=[];historyAt=-1;
      dialog.close();if(notice)notice.hidden=true;flowStep=pages.length?2:1;flowKey='';syncFlow();
    }finally{busy=false;hideOverlay();capture();}
  }
  function projectEditor(leaving=false){
    leaving=leaving===true;
    openDialog(leaving?'離開前，先把排版留在自己裝置':'儲存與繼續編輯');
    dialog.appendChild(node('p','照片與排版不會上傳到伺服器；以下兩種方式都存在你自己的裝置。','lp-local-note'));
    const draft=node('section',null,'lp-save-card');dialog.appendChild(draft);
    draft.appendChild(node('h3','下次用同一裝置繼續 → 自動草稿'));
    draft.appendChild(node('p','編輯後會自動儲存在目前瀏覽器。下次使用同一裝置、同一瀏覽器與同一版本（桌機／手機）開啟工具，按「繼續上次草稿」即可接著編輯。'));
    saveStatusEl=node('p',statusEl?.textContent||'尚未加入照片','lp-save-state');saveStatusEl.setAttribute('role','status');draft.appendChild(saveStatusEl);
    button('立即儲存到此裝置',()=>{clearTimeout(saveTimer);saveDraft();},row(draft)).disabled=!photos.length||busy;
    draft.appendChild(node('p','每個版本只保留一份最近草稿。清除網站資料、無痕瀏覽或更換裝置，可能無法找回。','lp-save-hint'));
    const backup=node('section',null,'lp-save-card');dialog.appendChild(backup);
    backup.appendChild(node('h3','長期保留或換裝置 → 下載專案'));
    backup.appendChild(node('p','把原始照片和排版一起存成 .dong.zip 檔。日後按「開啟專案檔」選取它，就能繼續修改，不必解壓縮。'));
    button('下載專案到我的裝置',exportProject,row(backup)).disabled=!photos.length||busy;
    backup.appendChild(node('p','檔案會交由瀏覽器下載，請確認已存入下載項目或你選擇的位置。匯出的 JPG 成品無法還原成可編輯專案。','lp-save-hint'));
    const actions=row();button('開啟專案檔',()=>pickFile('.zip',importProject),actions).disabled=busy;
    button('返回編輯',()=>dialog.close(),actions);
    const manage=section('管理此裝置的草稿');
    button('刪除本機草稿',async()=>{clearTimeout(saveTimer);await saveChain.catch(()=>{});await dbOperation('delete');draftPending=false;if(notice)notice.hidden=true;status('本機草稿已刪除；繼續編輯會重新儲存');},row(manage));
  }
  function remindBeforeLeaving(e){
    if(!photos.length)return;
    e.preventDefault();e.returnValue='';
    // The browser owns its close confirmation. If the user stays, show the local-save choices.
    setTimeout(()=>{if(!busy)projectEditor(true);},0);
  }
  function decorate(){
    const st=settings(),n=igMeta()?.panels||1;
    if(!mobile)document.querySelectorAll('.pageHead').forEach((head,pi)=>{
      if(head.dataset.plusOrganized)return;head.dataset.plusOrganized='1';
      const controls=[...head.children].slice(3).filter(el=>!(/換排法|自由/.test(el.textContent))),details=node('details',null,'lp-page-tools');details.appendChild(node('summary','本組設定'));
      const content=node('div',null,'lp-page-tools-content');controls.forEach(el=>content.appendChild(el));details.appendChild(content);const page=pages[pi];head._lpPage=page;details.open=pageToolsOpen.has(page);details.addEventListener('toggle',()=>{if(details.open)pageToolsOpen.add(page);else pageToolsOpen.delete(page);});head.appendChild(details);
    });
    if(!mobile && typeof maxZ!=='undefined')maxZ=Math.max(maxZ,...pages.flatMap(p=>Object.values(p.free||{}).map(f=>f.z||0)));
    document.querySelectorAll('.canvasBox').forEach((cv,i)=>{
      const p=mobile?pages[cur]:pages[i];if(!p)return;
      cv.querySelectorAll('.lp-brand-logo,.lp-brand-title,.lp-lock-badge').forEach(el=>el.remove());
      if((mobile?$('#bgMode').value:bgModeOf(p))==='brand')cv.style.background=brand.background;
      if(brand.logoOn && logoImg){for(let k=0;k<n;k++){const im=node('img',null,'lp-brand-logo');im.src=brand.logo;im.style.left=((k+.05)/n*100)+'%';im.style.bottom='5%';im.style.width=15/n+'%';im.style.height='12%';im.style.objectPosition='left bottom';cv.appendChild(im);}}
      if(brand.titleOn){const text=[brand.title,[brand.date,brand.place].filter(Boolean).join(' · ')].filter(Boolean).join('\n');if(text){const d=node('div',text,'lp-brand-title');d.style.left=5/n+'%';d.style.top='5%';d.style.maxWidth=80/n+'%';d.style.fontSize=3.6/n+'cqw';cv.appendChild(d);}}
      cv.querySelectorAll('.cell').forEach((el,j)=>{
        const id=+el.dataset.id || cells(p)[j]?.id;el.dataset.id=id;
        if(isLocked(p,id)||p.cropLocks?.[id])el.appendChild(node('span','🔒','lp-lock-badge'));
        if(!el.dataset.plusBound){el.addEventListener('click',()=>{selected={p,id};});if(mobile&&p.freeMode)bindMobileFree(el,p,id,cv);el.dataset.plusBound='1';}
        if(!mobile){const off=getOffset(p,id);if((off.z||1)>1){const ph=photoById(id),rect=cells(p).find(c=>c.id===id)?.rect,im=el.querySelector('img');if(rect&&im){const ar=rect.w/rect.h,z=off.z,w=(ph.ar>ar?ph.ar/ar:1)*100*z,h=(ph.ar>ar?1:ar/ph.ar)*100*z;Object.assign(im.style,{position:'absolute',objectFit:'fill',width:w+'%',height:h+'%',left:-(w-100)*off.ox+'%',top:-(h-100)*off.oy+'%'});}}}
        if(mobile && p.freeMode)el.style.zIndex=p.free[id]?.z||0;
      });
    });
  }
  function bindMobileFree(el,p,id,cv){
    const handle=node('span',null,'lp-free-handle');el.appendChild(handle);
    el.addEventListener('pointerdown',e=>{
      if(panning || e.button!==0 || isLocked(p,id))return;
      e.stopPropagation();e.preventDefault();selected={p,id};
      const f=p.free[id],origin={...f},box=cv.getBoundingClientRect(),mm=settings().w/box.width,sx=e.clientX,sy=e.clientY,resize=e.target===handle;
      let moved=false;el.setPointerCapture(e.pointerId);
      const move=ev=>{if(ev.pointerId!==e.pointerId)return;ev.stopPropagation();const dx=(ev.clientX-sx)*mm,dy=(ev.clientY-sy)*mm;moved ||= Math.hypot(dx,dy)>1;
        if(resize){f.w=Math.max(4,origin.w+dx);f.h=f.w/(origin.w/origin.h);}else{f.x=origin.x+dx;f.y=origin.y+dy;}
        const st=settings();el.style.left=f.x/st.w*100+'%';el.style.top=f.y/st.h*100+'%';el.style.width=f.w/st.w*100+'%';el.style.height=f.h/st.h*100+'%';
      };
      const end=ev=>{if(ev.pointerId!==e.pointerId)return;ev.stopPropagation();try{el.releasePointerCapture(e.pointerId);}catch(_){}el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);applyFocus(p);if(moved)render();changed();};
      el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
      el.addEventListener('click',ev=>{if(moved){ev.stopImmediatePropagation();ev.preventDefault();}},{capture:true,once:true});
    },true);
  }
  // A guided workspace; review records live with each page so drafts and projects retain them.
  let showHints=false;let flowStep=1,flowPanel,flowNav,flowKey='',reviewFilter='all',fitView=true;
  let outputFormats=[],formatChecks={},previewEpoch=0;
  const formatNames={ig34:'3:4 貼文',ig45:'4:5 貼文',ig11:'1:1 方形',igst:'9:16 限動'};
  function reviewKey(p,id){
    const r=cells(p).find(c=>c.id===id)?.rect,ph=photoById(id),f=p.focus?.[id];
    return JSON.stringify([id,ph?.file.name,ph?.file.size,r,getOffset(p,id),f&&[f.x,f.y],!!p.cropLocks?.[id],settings().nocrop]);
  }
  function reviewState(p,id){const r=p.reviews?.[id];return !r?'pending':r.key===reviewKey(p,id)?'done':'changed';}
  function reviewItems(){return pages.flatMap((p,pi)=>allIds(p).map(id=>({p,pi,id,state:reviewState(p,id)})));}
  function confirmPhoto(p,id,mode='focus'){p.reviews??={};p.reviews[id]={mode,key:reviewKey(p,id)};render();}
  function containRect(rect,ar){const r={...rect};if(r.w/r.h>ar){const w=r.h*ar;r.x+=(r.w-w)/2;r.w=w;}else{const h=r.w/ar;r.y+=(r.h-h)/2;r.h=h;}return r;}
  function keepWhole(p,id){ensureFree(p);p.free[id]=containRect(p.free[id],photoById(id).ar);p.offsets[id]={ox:.5,oy:.5,z:1};delete p.focus?.[id];confirmPhoto(p,id,'whole');}
  function outputKey(){return fingerprint(snapshot());}
  function setStep(step){if(busy)return;flowStep=step;flowKey='';syncFlow();}
  function reviewQueue(index=0,filter=reviewFilter){
    if(!pages.length)return;reviewFilter=filter;
    const all=reviewItems(),list=all.filter(x=>filter==='all'||filter==='pending'&&x.state!=='done'||filter==='changed'&&x.state==='changed');
    openDialog('確認構圖');dialog.classList.add('lp-review-dialog');
    const filters=row();for(const [v,label] of [['all','全部'],['pending','待確認'],['changed','需再確認']]){const b=button(label,()=>reviewQueue(0,v),filters);b.setAttribute('aria-pressed',filter===v);}
    const done=all.filter(x=>x.state==='done').length;dialog.appendChild(node('p',`已確認 ${done} / ${all.length} 張 · 主體標記協助裁切，仍需檢查成品。`));
    if(!list.length){dialog.appendChild(node('p','這個清單已全部確認。'));button('前往預覽與尺寸',()=>{dialog.close();setStep(4);},row()).className='lp-primary';return;}
    index=clamp(index,0,list.length-1);const {p,pi,id,state}=list[index];selected={p,id};
    const ph=photoById(id),nav=row();button('上一張',()=>reviewQueue(index-1,filter),nav).disabled=index===0;
    const jump=field(nav,'照片',index+1,'number',v=>reviewQueue(Math.round(+v||1)-1,filter));jump.min=1;jump.max=list.length;
    nav.appendChild(node('span',`/ ${list.length} · 第 ${pi+1} 組 · ${state==='done'?'已確認':state==='changed'?'需再確認':'待確認'}`,'lp-count'));
    button('下一張',()=>reviewQueue(index+1,filter),nav).disabled=index===list.length-1;
    const grid=node('div',null,'lp-review-grid'),original=node('div'),result=node('div');grid.append(original,result);dialog.appendChild(grid);
    original.appendChild(node('h3','點一下，要保留的主體'));
    const wrap=node('div',null,'lp-focus-photo'),im=node('img'),dot=node('span',null,'lp-focus-dot');im.src=ph.url;im.alt=ph.file.name;wrap.append(im,dot);original.appendChild(wrap);
    result.appendChild(node('h3','目前裁切'));const resultStage=node('div',null,'lp-review-result');result.appendChild(resultStage);
    const paint=()=>{const f=p.focus?.[id];dot.hidden=!f;if(f){dot.style.left=f.x*100+'%';dot.style.top=f.y*100+'%';}
      const r=cells(p).find(c=>c.id===id)?.rect;if(!r)return;const off=getOffset(p,id),W=ph.img.naturalWidth,H=ph.img.naturalHeight,ar=r.w/r.h,z=off.z||1;
      const cv=node('canvas');cv.width=Math.min(420,Math.round(420*ar));cv.height=Math.round(cv.width/ar);const sw=(W/H>ar?H*ar:W)/z,sh=sw/ar;
      cv.getContext('2d').drawImage(ph.img,(W-sw)*off.ox,(H-sh)*off.oy,sw,sh,0,0,cv.width,cv.height);resultStage.replaceChildren(cv);
    };
    wrap.onclick=e=>{if(p.cropLocks?.[id]){status('請先解除裁切固定，再標記主體');return;}const r=im.getBoundingClientRect();p.focus??={};p.focus[id]={x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height)};applyFocus(p);render();paint();};
    if(p.cropLocks?.[id])button('解除裁切固定',()=>{p.cropLocks[id]=false;render();reviewQueue(index,filter);},row());
    const actions=row();button('維持置中',()=>{if(p.cropLocks?.[id])return;delete p.focus?.[id];p.offsets[id]={ox:.5,oy:.5,z:1};render();paint();},actions).disabled=!!p.cropLocks?.[id];
    button('保留完整照片',()=>{keepWhole(p,id);reviewQueue(index,filter);},actions).disabled=isLocked(p,id)||!!p.cropLocks?.[id];
    dialog.appendChild(node('p','保留完整照片會縮小這張照片並留下空間；合照或文字較適合使用。','lp-save-hint'));
    button('確認，下一張 →',()=>{confirmPhoto(p,id,p.reviews?.[id]?.mode==='whole'&&!p.focus?.[id]?'whole':p.focus?.[id]?'focus':'center');if(index===list.length-1&&filter==='all'){dialog.close();setStep(4);}else reviewQueue(filter==='all'?index+1:index,filter);},row()).className='lp-primary';
    paint();
  }
  function scaledPage(p,from,to){
    const q=clone(p);ensureFree(q);
    for(const [id,f] of Object.entries(q.free)){f.x*=to.w/from.w;f.w*=to.w/from.w;f.y*=to.h/from.h;f.h*=to.h/from.h;
      if(p.reviews?.[id]?.mode==='whole'&&reviewState(p,+id)==='done')q.free[id]=containRect(f,photoById(id).ar);
    }
    for(const {id,rect} of cells(q))if(q.focus?.[id]&&!q.cropLocks?.[id])q.offsets[id]=focalOffset(photoById(id).ar,rect.w/rect.h,q.focus[id],getOffset(q,id).z||1);
    return q;
  }
  function formatSettings(format){const from=settings(),n=igMeta()?.panels||1;return {...from,w:108*n,h:{ig34:144,ig45:135,ig11:108,igst:192}[format]};}
  async function multiExport(formats){
    formats=formats.filter(f=>formatNames[f]);if(busy||!pages.length||!formats.length)return;
    dialog?.close();busy=true;updateHistoryButtons();await loadLogo();showOverlay('準備圖片…',0);
    try{const zip=new JSZip(),from=settings(),n=igMeta()?.panels||1,total=formats.length*pages.length*n;let done=0;
      for(const format of formats){const st=formatSettings(format);for(let i=0;i<pages.length;i++){const p=scaledPage(pages[i],from,st);
        for(let k=0;k<n;k++){const cv=await paintTile(p,k,{st,panels:n,width:1080,original:true}),blob=await jpegBlob(cv,.9);zip.file(`${format}/組${String(i+1).padStart(2,'0')}-${String(k+1).padStart(2,'0')}.jpg`,blob);cv.width=0;cv.height=0;showOverlay(`產生 ${++done} / ${total} 張`,done/total);await new Promise(r=>setTimeout(r,0));}
      }}triggerDownload(await zip.generateAsync({type:'blob'}),'排版-多比例.zip');
    }catch(e){alert('匯出失敗：'+e.message);}finally{busy=false;hideOverlay();updateHistoryButtons();syncFlow();}
  }
  async function formatPreview(format=outputFormats[0],at=0){
    if(!format||!pages.length)return;openDialog('預覽其他尺寸');const epoch=++previewEpoch,key=outputKey(),n=igMeta()?.panels||1,total=pages.length*n;
    const tabs=row();outputFormats.forEach(f=>{const b=button(formatNames[f],()=>formatPreview(f,0),tabs);b.setAttribute('aria-pressed',f===format);});
    at=clamp(at,0,total-1);const pi=Math.floor(at/n),k=at%n,st=formatSettings(format),p=scaledPage(pages[pi],settings(),st);
    dialog.appendChild(node('p',`${formatNames[format]} · 第 ${pi+1} 組，第 ${k+1} 頁 · ${at+1} / ${total}`));
    const stage=node('div',null,'lp-preview-stage');dialog.appendChild(stage);const nav=row();button('上一張',()=>formatPreview(format,at-1),nav).disabled=at===0;
    const jump=field(nav,'跳至',at+1,'number',v=>formatPreview(format,Math.round(+v||1)-1));jump.min=1;jump.max=total;
    button('下一張',()=>formatPreview(format,at+1),nav).disabled=at===total-1;
    dialog.appendChild(node('p','檢查人物、文字是否完整，以及跨頁接縫；主體標記不代表裁切一定安全。'));
    const confirm=button('這張已檢查，繼續 →',()=>{if(outputKey()!==key){formatChecks={};formatPreview(format,at);return;}formatChecks[format]??={key,seen:[]};if(formatChecks[format].key!==key)formatChecks[format]={key,seen:[]};if(!formatChecks[format].seen.includes(at))formatChecks[format].seen.push(at);
      if(at+1<total)formatPreview(format,at+1);else{const next=outputFormats[outputFormats.indexOf(format)+1];if(next)formatPreview(next);else{dialog.close();setStep(5);}}syncFlow();},row());confirm.className='lp-primary';confirm.disabled=true;
    const cv=await paintTile(p,k,{st,panels:n,width:720});if(epoch!==previewEpoch||!dialog.open||dialog.dataset.view!=='預覽其他尺寸')return;stage.appendChild(cv);confirm.disabled=false;
  }
  function chooseFormats(){
    openDialog('產生其他尺寸');const items=reviewItems(),pending=items.filter(x=>x.state!=='done').length;
    if(pending){dialog.appendChild(node('p',`還有 ${pending} 張未確認構圖。先標記主體，可減少換比例時裁掉人物的情況。`,'lp-warning'));button('先確認構圖',()=>reviewQueue(0,'pending'),row()).className='lp-primary';}
    dialog.appendChild(node('p','選擇額外尺寸，下一步會逐張預覽。原本的編排保持不變。'));
    const choices=row();const checks=Object.entries(formatNames).map(([id,label])=>[id,field(choices,label,outputFormats.includes(id),'checkbox')]);
    const next=button(pending?'先選尺寸並預覽':'預覽選取尺寸 →',()=>{outputFormats=checks.filter(([,el])=>el.checked).map(([id])=>id);formatPreview();syncFlow();},row());if(!pending)next.className='lp-primary';
    const update=()=>next.disabled=!checks.some(([,el])=>el.checked);checks.forEach(([,el])=>el.onchange=update);update();
  }
  function downloadOutput(){
    const run=()=>{dialog?.close();if(outputFormats.length)multiExport(outputFormats);else $(mobile?'#exportBtn':'#expJpg').click();};
    const pending=reviewItems().filter(x=>x.state!=='done').length,key=outputKey(),total=pages.length*(igMeta()?.panels||1);
    const unchecked=outputFormats.some(f=>formatChecks[f]?.key!==key||formatChecks[f].seen.length<total);
    if(pending||unchecked){openDialog('下載前，再確認一下');dialog.appendChild(node('p',`${pending?`${pending} 張照片尚未確認構圖。`:''}${unchecked?'其他尺寸還有尚未檢查的圖片。':''}`));
      button('繼續檢查',()=>pending?reviewQueue(0,'pending'):formatPreview(),row()).className='lp-primary';button('仍要下載',run,row());return;}
    run();
  }
  function fitWorkspace(){
    if(mobile||!fitView||!pages.length)return;const wrap=$('#pagesWrap'),st=settings();
    if(!wrap?.clientHeight)return;const height=Math.max(180,wrap.clientHeight-70),width=Math.max(200,wrap.clientWidth-48);
    const n=igMeta()?.panels||1;const size=Math.max(160,Math.min(width,height*st.w/st.h/n))*n,percent=Math.round(size/820*100);$('#zoom').value=percent;$('#zoomLbl').textContent=percent+'%';$('#pages').style.setProperty('--pw',Math.round(820*percent/100)+'px');
  }
  function syncFlow(){
    if(!flowPanel)return;fitWorkspace();document.body.dataset.lpStep=String(flowStep);
    bar.querySelectorAll('[data-action]').forEach(b=>{if(['shuffle','edit','preview','download'].includes(b.dataset.action)){b.disabled=!pages.length||(b.dataset.action==='shuffle'&&currentPage()?.freeMode);b.title=!pages.length?'請先選照片並建立頁面':b.disabled?'自由編輯時保留位置；可從本組工具切回自動排版再換排法':'';}if(b.dataset.action==='make'){const used=new Set(pages.flatMap(allIds)),count=photos.filter(p=>p.sel&&!used.has(p.id)).length;b.disabled=!count;b.textContent=count?'建立頁面（'+count+'）':'建立頁面';b.title=count?'':'請先在照片池選取未使用照片';}});const items=reviewItems(),done=items.filter(x=>x.state==='done').length,used=new Set(pages.flatMap(allIds)),sel=photos.filter(p=>p.sel&&!used.has(p.id)).length;
    const key=JSON.stringify([flowStep,photos.length,pages.length,sel,done,items.length,outputFormats,formatChecks,mobile?curPreset:$('#preset').value,igMeta()?.panels]);if(key===flowKey)return;flowKey=key;
    [...flowNav.children].forEach((b,i)=>{b.setAttribute('aria-current',i+1===flowStep?'step':'false');b.disabled=false;b.dataset.complete=String(i===0?pages.length>0:i===2?items.length>0&&done===items.length:false);});
    flowPanel.replaceChildren();const copy=node('div',null,'lp-flow-copy'),actions=node('div',null,'lp-flow-actions');flowPanel.append(copy,actions);
    const titles=['選好照片，開始一組作品','先排出你想說的故事','把重要的人物與細節留下來','看看成品，再延伸其他尺寸','帶走成品，也留住編排'];
    const hints=[`${photos.length} 張照片 · 選取 ${sel} 張。可分批建立多組，拖動調整順序。`,'先選主要用途，再比較排法；留白、背景與署名可稍後調整。',`已確認 ${done} / ${items.length} 張；換版型或改裁切後，會提示重新確認。`,'先看輪播接縫；需要貼文與限動時，再產生其他尺寸。',outputFormats.length?`輸出：${outputFormats.map(f=>formatNames[f]).join('、')}`:'輸出目前比例；可另存專案，下次繼續修改。'];
    copy.append(node('h2',titles[flowStep-1]));const hint=node('p',hints[flowStep-1]);hint.hidden=!showHints;copy.appendChild(hint);button(showHints?'收起說明':'步驟說明',()=>{showHints=!showHints;flowKey='';syncFlow();},copy);
    const primary=(label,fn)=>{const b=button(label,()=>{if(!busy)fn();},actions);b.className='lp-primary';return b;};
    if(flowStep===1){const allUsed=pages.length>0&&used.size===photos.length;primary(sel?'開始排版 →':allUsed?'繼續排版 →':photos.length?'選取未使用照片':'加入照片',()=>{if(photos.some(p=>p.sel&&!new Set(pages.flatMap(allIds)).has(p.id))){$('#makePage').click();setStep(2);}else if(allUsed){setStep(2);}else if(photos.length){$('#selAll').click();}else $('#file').click();});if(photos.length)button('加入照片',()=>$('#file').click(),actions);if(pages.length&&!allUsed)button('繼續排版 →',()=>setStep(2),actions);}
    if(flowStep===2){primary('確認構圖 →',()=>setStep(3));}
    if(flowStep===3){primary(done===items.length?'預覽成品 →':'開始逐張確認 →',()=>done===items.length?setStep(4):reviewQueue(0,'pending'));button('查看全部照片',()=>reviewQueue(0,'all'),actions);button('先預覽',()=>setStep(4),actions);}
    if(flowStep===4){primary('預覽目前比例',preview);button('產生其他尺寸',chooseFormats,actions);button('前往下載 →',()=>setStep(5),actions);}
    if(flowStep===5){primary('下載圖片',downloadOutput);button('保存可編輯專案',()=>projectEditor(),actions);if(outputFormats.length)button('改用目前比例',()=>{outputFormats=[];syncFlow();},actions);}
    if(!pages.length&&flowStep>1)actions.querySelectorAll('button').forEach(b=>{if(!['比例用途'].includes(b.textContent)){b.disabled=true;b.title='請先選照片並建立頁面';}});
  }
  function showFormatControls(){
    openDialog('比例與用途');
    // Reuse the native controls and handlers; return them to their original location on close.
    const controls=mobile?[$('#presets')]:[$('#preset').parentElement];
    controls.filter(Boolean).forEach(el=>{
      const anchor=node('span');el.before(anchor);dialog.appendChild(el);
      dialog.addEventListener('close',()=>anchor.replaceWith(el),{once:true});
    });
  }
  function fitCanvas(){
    if(mobile){
      resetView();const n=igMeta()?.panels||1;
      view.s=n;view.tx=(n-1)/2*$('#cv').clientWidth;applyView();
    }else{fitView=true;fitWorkspace();}
  }
  function setupFlow(){
    document.body.classList.add('lp-guided');document.body.classList.add(mobile?'lp-mobile':'lp-desktop');
    flowNav=node('nav',null,'lp-flow-nav');flowNav.setAttribute('aria-label','編排流程');['選照片','排版面','確認構圖','預覽與尺寸','下載與保留'].forEach((label,i)=>{const b=button('',()=>setStep(i+1),flowNav);b.append(node('span',String(i+1),'lp-step-number'),node('span',label));});
    flowPanel=node('section',null,'lp-flow-panel');bar.before(flowNav);bar.after(flowPanel);
    if(!mobile){const header=document.querySelector('header');if(header){const controls=[...header.children].filter(el=>el.tagName!=='H1');const details=node('details',null,'lp-settings');details.appendChild(node('summary','頁面設定 · 留白、背景與署名'));const content=node('div',null,'lp-settings-content');controls.forEach(el=>content.appendChild(el));details.appendChild(content);header.appendChild(details);}}
    if(!mobile&&!photos.length&&$('#preset').value==='297x210'){$('#preset').value='ig45';$('#preset').onchange();}
    if(!mobile){const zoom=$('#zoom');zoom.setAttribute('aria-label','畫布縮放');zoom.min=5;zoom.max=3000;const original=zoom.oninput;zoom.oninput=()=>{fitView=false;original?.();};new ResizeObserver(fitWorkspace).observe($('#pagesWrap'));}
    if(!mobile){bar.appendChild($('#zoom'));bar.appendChild($('#zoomLbl'));}else{const z=node('input');z.type='range';z.min=100;z.max=8000;z.value=100;z.setAttribute('aria-label','畫布縮放');const label=node('span','100%');z.oninput=()=>{view.s=+z.value/100;applyView();};bar.append(z,label);const originalApply=applyView;applyView=function(){$('#cv').style.setProperty('--lp-handle-scale',String(1/view.s));originalApply();z.value=Math.round(view.s*100);label.textContent=z.value+'%';};}const empty=$(mobile?'#emptyStage':'#empty');if(empty)empty.textContent='從選照片開始，把一組故事排出來。';
    syncFlow();
  }

  function setup(){
    const opt=node('option','品牌背景色');opt.value='brand';$('#bgMode').appendChild(opt);
    bar=node('div',null,'lp-bar');bar.setAttribute('aria-label','排版工作工具');
    const items=[
      ['add','加入照片',()=>$('#file').click()],
      ['make','建立頁面',()=>$('#makePage').click()],
      ['pool','照片池',()=>document.body.classList.toggle('lp-pool-hidden')],
      ['format','比例用途',showFormatControls],
      ['shuffle','換排法',()=>{if(mobile)$('#shuffleBtn').click();else{const p=currentPage();if(p&&!p.freeMode){shufflePage(p);render();}}}],
      ['edit','照片調整',editing],['preview','預覽',preview],['download','下載',downloadOutput],
      ['settings','頁面設定',()=>{if(mobile)$('#settingsBtn').click();else{const el=document.querySelector('.lp-settings');el.open=!el.open;}}],
      ['fit','符合畫布',fitCanvas],['undo','↶',()=>undo(-1)],['redo','↷',()=>undo(1)],
      ['save','儲存',()=>projectEditor()]
    ];
    items.forEach(([id,text,fn])=>{const b=button(text,()=>{if(busy)return;fn();},bar);b.dataset.action=id;
      if(id==='undo'||id==='redo'){b.title=id==='undo'?'復原（⌘ / Ctrl Z）':'重做（⌘ / Ctrl Shift Z）';b.setAttribute('aria-label',id==='undo'?'復原':'重做');}
    });
    button('更多',()=>{if(busy)return;openDialog('更多工具');
      const layout=section('版型',dialog,true);if(!mobile)button('全部換排法',()=>{dialog.close();$('#shuffleAll').click();},row(layout));button('比較排法',()=>candidates(),row(layout));button('儲存與套用版型',templates,row(layout));
      const output=section('作品設定',dialog,true);button('署名與 Logo',brandEditor,row(output));
      if(!mobile)button('畫布符合視窗',()=>{fitView=true;fitWorkspace();dialog.close();},row());
      const files=section('檔案',dialog,true);button('草稿與專案',projectEditor,row(files));
      if(!mobile){button('下載 PDF',()=>{dialog.close();$('#expPdf').click();},row(files));button('下載 PowerPoint',()=>{dialog.close();$('#expPptx').click();},row(files));}
    },bar);
    statusEl=node('span','本機草稿','lp-status');statusEl.setAttribute('role','status');bar.appendChild(statusEl);
    const target=mobile?$('#igInfo'):document.querySelector('main');target.before(bar);
    notice=node('div',null,'lp-notice');notice.hidden=true;bar.after(notice);
    dialog=node('dialog',null,'lp-dialog');document.body.appendChild(dialog);dialog.addEventListener('close',()=>{dialog.onkeydown=null;});
    if(mobile){button('編排工具',()=>{selected={p:pages[cur],id:sheetPhoto};closeSheets();editing();},$('#photoSheet')).className='opt';}
    setupFlow();
    const originalRender=render;render=function(){document.querySelectorAll('.pageHead').forEach(head=>{const p=head._lpPage,details=head.querySelector('.lp-page-tools');if(p&&details){if(details.open)pageToolsOpen.add(p);else pageToolsOpen.delete(p);}});originalRender();decorate();changed();syncFlow();};
    if(mobile){const originalCanvas=renderCanvas;renderCanvas=function(){if(!pages.length)return;originalCanvas();decorate();changed();syncFlow();};}
    document.addEventListener('change',e=>{if(e.target.closest('#sigPanel,#settingsSheet,header'))changed();});
    document.addEventListener('input',e=>{if(e.target.closest('#sigPanel,#settingsSheet,header')){clearTimeout(e.target._plusTimer);e.target._plusTimer=setTimeout(changed,250);}});
    document.addEventListener('click',()=>setTimeout(syncFlow,0));document.addEventListener('pointerup',()=>setTimeout(changed,0));document.addEventListener('drop',()=>setTimeout(changed,0));
    document.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('input,textarea,select,[contenteditable=true]')){e.preventDefault();undo(e.shiftKey?1:-1);}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'&&!e.target.closest('input,textarea,select,[contenteditable=true]')){e.preventDefault();undo(1);}
    });
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&draftPending)saveDraft();});
    window.addEventListener('beforeunload',remindBeforeLeaving);
    capture();decorate();syncFlow();
    dbOperation('get').then(data=>{if(!data?.files?.length)return;draftAvailable=data;notice.hidden=false;notice.appendChild(node('span',`此裝置留有上次排版（${data.files.length} 張照片）`));button('繼續上次草稿',()=>restoreDraft(draftAvailable),notice);button('稍後',()=>notice.hidden=true,notice);}).catch(()=>status('無法使用本機草稿；可下載專案備份'));
  }
  window.LayoutPlus={background,extrasOn:()=>brand.logoOn||brand.titleOn,focalOffset,cells,spanPhoto,regionShuffle,snapshot,restoreState,saveTemplate,applyTemplate,validateTemplates,validateProject,paintTile,editing,capture,undo,saveDraft,windowRange,reviewKey,reviewState,reviewItems,confirmPhoto,keepWhole,scaledPage,multiExport,setStep,syncFlow,replacePhoto};
  if(!window.__LAYOUT_PLUS_TEST__)setup();
})();
