const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname,'..');
const extension = fs.readFileSync(path.join(root,'editor-plus.js'),'utf8');
const extract = (s,name) => s.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n\\}'))[0];
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.style={setProperty(k,v){this[k]=v;}};this.clientWidth=900;this.clientHeight=600;this.dataset={};this.type='';this.value='';this.checked=false;this.listeners={};this.attributes={};this.classList={add(){},remove(){},toggle(){}};}
  appendChild(el){this.children.push(el);return el;}
  append(...els){els.forEach(el=>this.appendChild(el));}
  prepend(el){this.children.unshift(el);}
  replaceChildren(...els){this.children=els;}
  before(el){this.beforeElement=el;}
  after(el){this.afterElement=el;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(type,fn){this.listeners[type]=fn;}
  querySelector(selector){return this.children.find(el=>selector===`[data-action=${el.dataset.action}]`)||null;}
  querySelectorAll(){return [];}
  close(){this.open=false;this.listeners.close?.();}
  showModal(){this.open=true;}
  getContext(){return {translate(){},save(){},restore(){},fillRect(){},drawImage(){},fillText(){},measureText(t){return {width:t.length*6};}};}
}
function environment(mobile,setup=false,fullClient=false){
  const elements={};
  for(const [id,value] of Object.entries({preset:'igc',igPanels:3,carouselRatio:1350,margin:0,gutter:0,scale:100,bgMode:'white',sigText:'Dong Lin Photo',sigFont:'sans',sigPos:'br',sigSize:4,sigColor:'#ffffff',sigOp:85,qual:90,dpi:300})){
    const el=elements[id]=new Element();el.value=value;
  }
  for(const id of ['sigOn','nocrop','keepOrder']){const el=elements[id]=new Element();el.type='checkbox';el.checked=id==='keepOrder';}
  for(const id of ['shuffleBtn','opStar','opRemove','photoSheet','igInfo','sigOpLbl','qualLbl','custSize','igPanelsBox','panelCtl','pCount'])elements[id]=new Element();
  const main=new Element(),body=new Element(),drafts=new Map(),downloads=[],zipFiles=[],encodings=[];
  const document={body,visibilityState:'visible',listeners:{},createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element(),getElementById:id=>elements[id]|| (fullClient ? (elements[id]=new Element()) : null),
    querySelector:s=>s==='#stage'?(mobile?new Element():null):s==='main'?main:elements[s.slice(1)]|| (fullClient ? (elements[s.slice(1)]=new Element()) : null),
    querySelectorAll:()=>[],addEventListener(type,fn){this.listeners[type]=fn;}};
  const db={createObjectStore(){},close(){},transaction(){const tx={error:null};tx.objectStore=()=>({
    get(key){const req={result:drafts.get(key)};queueMicrotask(()=>tx.oncomplete?.());return req;},
    put(value,key){drafts.set(key,value);const req={result:key};queueMicrotask(()=>tx.oncomplete?.());return req;},
    delete(key){drafts.delete(key);const req={};queueMicrotask(()=>tx.oncomplete?.());return req;}
  });return tx;}};
  const context={document,window:{__LAYOUT_PLUS_TEST__:!setup,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}},localStorage:{getItem(){return null;},setItem(){}},indexedDB:{open(){const req={result:db};queueMicrotask(()=>req.onsuccess());return req;}},
    photos:[],pages:[],nextId:1,cur:0,curPreset:'igc',panels:3,PRESETS:{ig34:{},ig45:{},ig11:{},igst:{}},PREVIEW_PX:1000,
    $:s=>elements[s.slice(1)]||new Element(),getOffset:(p,id)=>p.offsets[id]||{ox:.5,oy:.5,z:1},
    photoById:id=>context.photos.find(ph=>ph.id===+id),allIds:p=>p.regions.flatMap(r=>r.photoIds),findRegion:(p,id)=>p.regions.find(r=>r.photoIds.includes(+id)),
    render(){},renderCanvas(){},cropMode:()=> 'crop',drawRect:(...args)=>args.at(-1),drawSigOn(){},SIG_FONTS:{sans:'sans-serif'},
    drawSigOn(){},bgModeOf:()=>elements.bgMode.value,bgPhotoOf:p=>context.photos.find(ph=>ph.id===context.allIds(p)[0]),blurDraw(){},
    swapPhotos(){},movePhotoToPage(){},removePhotoFromPage(){},startPanDrag(){},handlePointerMove(){},toggleFree(){},doSwap(){},startPan(){},
    selCell:null,ptr:null,dragData:null,panning:null,swapFrom:null,closeSheets(){},resetView(){},updLbls(){},
    setTimeout:(fn,ms)=>{if(ms===0)queueMicrotask(fn);return 1;},clearTimeout(){},queueMicrotask,Image:class {async decode(){}},
    File,Blob,URL,showOverlay(){},hideOverlay(){},alert(msg){throw Error(msg);},
    cropCanvas:async()=>({width:10,height:10}),jpegBlob:async cv=>{encodings.push([cv.width,cv.height]);return new Blob(['jpeg']);},
    triggerDownload:(blob,name)=>downloads.push(name),
    JSZip:class {file(name,value){zipFiles.push(name);return this;}async generateAsync(){return new Blob(['zip']);}},
    location:{protocol:'file:',hostname:'',search:''},navigator:{},matchMedia:()=>({matches:false}),screen:{width:1400,height:900},
    getComputedStyle:()=>({paddingLeft:'20',paddingRight:'20'}),ResizeObserver:class {observe(){}},fetch:async()=>({json:async()=>({value:0})}),
    addEventListener(){},view:{s:1,tx:0,ty:0},
  };
  context.igMeta=()=>({panels:mobile?context.panels:+elements.igPanels.value,pw:1080,ph:+elements.carouselRatio.value});
  context.settings=()=>({w:context.igMeta().panels*108,h:context.igMeta().ph/10,margin:0,gutter:0,scale:100,nocrop:false});
  const source=fs.readFileSync(path.join(root,mobile?'m/index.html':'index.html'),'utf8');
  const core=['aspectOf','layoutTree','randTree','genCandidates','normalizeRegions','regionRects','relayoutRegion','relayoutPage','computeCells'];
  const ctx=vm.createContext(context);
  if(fullClient){
    context.window=context;context.__LAYOUT_PLUS_TEST__=!setup;
    const client=[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('let photos = []'));
    vm.runInContext(client,ctx);
  }else vm.runInContext(core.map(name=>extract(source,name)).join('\n')+'\n'+(mobile?"const treeSig=n=>n.leaf!==undefined?'L'+n.leaf:n.dir+'('+treeSig(n.a)+','+treeSig(n.b)+')';":extract(source,'treeSig')),ctx);
  vm.runInContext(extension,ctx);
  return {ctx,plus:ctx.window.LayoutPlus,elements,drafts,downloads,zipFiles,encodings,body,main,document};
}
function fixture(env,count=9){
  const {ctx}=env;
  ctx.photos=Array.from({length:count},(_,i)=>({id:i+1,file:new File(['photo'],`photo-${i}.jpg`,{type:'image/jpeg'}),ar:i%3===0?.66:1.5,img:{naturalWidth:i%3===0?660:1500,naturalHeight:1000},url:'blob:test'}));
  ctx.nextId=count+1;const p={regions:[{photoIds:ctx.photos.map(ph=>ph.id),stars:[],cands:[],candIdx:0}],offsets:{},cells:{},free:{},freeMode:false};ctx.pages=[p];ctx.relayoutPage(p);return p;
}
async function check(mobile){
  const env=environment(mobile),{ctx,plus,elements}=env;let p=fixture(env);
  // Locks stop both candidate regeneration and individual-region shuffling.
  p.regions[0].locked=true;const frozen=JSON.stringify(p.regions[0]);const cells=JSON.stringify(p.cells);
  ctx.relayoutRegion(p,p.regions[0],0);plus.regionShuffle(p,0);assert.equal(JSON.stringify(p.regions[0]),frozen);
  plus.regionShuffle(p,1);assert.equal(JSON.stringify(p.regions[0]),frozen);
  assert.deepEqual(JSON.stringify(Object.fromEntries(p.regions[0].photoIds.map(id=>[id,p.cells[id]]))),JSON.stringify(Object.fromEntries(JSON.parse(cells)&&p.regions[0].photoIds.map(id=>[id,JSON.parse(cells)[id]]))));
  // Cross-page placement clamps to available panels, preserves existing neighbors and layer order.
  const before=plus.cells(p).map(c=>({id:c.id,rect:{...c.rect}}));
  plus.spanPhoto(p,5,100,2);assert.equal(p.freeMode,true);assert.equal(p.free[5].x,108);assert.equal(p.free[5].w,216);assert.equal(p.free[5].h,135);
  for(const c of before.filter(c=>c.id!==5))for(const key of ['x','y','w','h'])assert.equal(p.free[c.id][key],c.rect[key]);
  assert.ok(p.layoutLocks[1]);
  elements.carouselRatio.value=1440;ctx.computeCells(p);assert.equal(p.free[5].h,144);
  if(mobile){const positions=[{...p.free[5]},{...p.free[6]}];ctx.doSwap(p,5,6);assert.equal(p.free[5].x,positions[1].x);ctx.doSwap(p,5,6);}
  // Focal point is inside the crop for portrait/landscape/photo zoom; clamped edges remain valid.
  for(const ar of [.5,1,1.5,3])for(const ca of [.5,1,2,4])for(const z of [1,2,4])for(const x of [0,.1,.5,.9,1]){
    const off=plus.focalOffset(ar,ca,{x,y:.7},z),sw=(ar>ca?ca:ar)/z,sh=sw/ca;
    const sx=(ar-sw)*off.ox,sy=(1-sh)*off.oy;
    assert.ok(off.ox>=0&&off.ox<=1&&off.oy>=0&&off.oy<=1);
    assert.ok(x*ar>=sx-1e-9&&x*ar<=sx+sw+1e-9);assert.ok(.7>=sy-1e-9&&.7<=sy+sh+1e-9);
  }
  // Undo restores geometry and imported photo references, and editing after undo discards redo.
  plus.capture();const initial=plus.snapshot();p.free[5].x=77;plus.capture();plus.undo(-1);assert.equal(ctx.pages[0].free[5].x,initial.pages[0].free[5].x);
  plus.undo(1);assert.equal(ctx.pages[0].free[5].x,77);plus.undo(-1);ctx.pages[0].free[5].x=88;plus.capture();plus.undo(1);assert.equal(ctx.pages[0].free[5].x,88);
  ctx.photos=ctx.photos.slice(1);plus.capture();plus.undo(-1);assert.equal(ctx.photos.length,9);p=ctx.pages[0];
  // Portable layout carries normalized slots, crop/subject coordinates; wrong photo count is rejected.
  const template=plus.saveTemplate('活動版型',p);plus.validateTemplates({version:1,templates:[template]});
  p.free[5].x=1;plus.applyTemplate(template,p);assert.equal(p.free[5].x,88);
  assert.throws(()=>plus.validateTemplates({version:1,templates:[{...template,slots:[{x:0,y:0,w:-1,h:1}]}]}));
  const state=plus.snapshot();plus.validateProject(state,ctx.photos.map(ph=>({id:ph.id})));
  assert.throws(()=>plus.validateProject(state,ctx.photos.map(()=>({id:1}))),/照片資料/);
  // Draft persistence stores original File bytes alongside a serializable snapshot.
  await plus.saveDraft();const draft=env.drafts.get(mobile?'mobile':'desktop');assert.equal(draft.files.length,9);assert.equal(await draft.files[0].file.text(),'photo');assert.equal(draft.state.pages[0].free[5].x,88);
  assert.equal(typeof plus.multiExport,'function');
  // Review validity follows actual geometry and crop state, and travels in the project snapshot.
  plus.confirmPhoto(p,5);assert.equal(plus.reviewState(p,5),'done');
  p.offsets[5].ox=.17;assert.equal(plus.reviewState(p,5),'changed');
  plus.confirmPhoto(p,5);p.free[5].w+=1;assert.equal(plus.reviewState(p,5),'changed');
  plus.keepWhole(p,5);assert.equal(plus.reviewState(p,5),'done');
  assert.ok(Math.abs(p.free[5].w/p.free[5].h-ctx.photos[4].ar)<1e-8);
  assert.equal(plus.snapshot().pages[0].reviews[5].mode,'whole');
  const fitted=plus.scaledPage(p,ctx.settings(),{...ctx.settings(),h:192});
  assert.ok(Math.abs(fitted.free[5].w/fitted.free[5].h-ctx.photos[4].ar)<1e-8);
  const original=JSON.stringify(plus.snapshot());await plus.multiExport(['ig34','igst']);
  assert.equal(JSON.stringify(plus.snapshot()),original,'export must not mutate layout or review records');
  assert.deepEqual(env.encodings,[[1080,1440],[1080,1440],[1080,1440],[1080,1920],[1080,1920],[1080,1920]]);
  assert.equal(env.downloads[0],'排版-多比例.zip');
  assert.deepEqual({...plus.windowRange(200,199)},{start:192,end:200});
  assert.deepEqual({...plus.windowRange(201,200)},{start:200,end:201});
  // Both clients initialize the actual extension UI without a backend or missing controls.
  const ui=environment(mobile,true);await Promise.resolve();const bar=mobile?ui.elements.igInfo.beforeElement:ui.main.beforeElement;
  assert.equal(bar.children.filter(el=>el.tagName==='button').length,4);assert.ok(ui.body.children.some(el=>el.tagName==='dialog'));
  let blocked=false;ui.ctx.window.listeners.beforeunload({preventDefault(){blocked=true;}});assert.equal(blocked,false);
  fixture(ui);ui.plus.setStep(1);assert.equal(bar.afterElement.children[1].children[0].textContent,'繼續排版 →');bar.children.find(el=>el.dataset.action==='save').onclick();
  const saveDialog=ui.body.children.find(el=>el.tagName==='dialog');
  assert.ok(saveDialog.children.some(el=>el.textContent?.includes('不會上傳')));
  const savedNote=saveDialog.children.find(el=>el.className==='lp-save-card').children.find(el=>el.className==='lp-save-state');
  await ui.plus.saveDraft();assert.equal(savedNote.textContent,'草稿已存於此裝置');
  const leaving={preventDefault(){blocked=true;}};ui.ctx.window.listeners.beforeunload(leaving);await Promise.resolve();
  assert.equal(blocked,true);assert.equal(leaving.returnValue,'');
  assert.equal(saveDialog.dataset.view,'離開前，先把排版留在自己裝置');
  // Hundreds of photos keep a bounded selector and allow direct navigation to the last photo.
  fixture(ui,201);ui.plus.editing();
  const modal=ui.body.children.find(el=>el.tagName==='dialog');
  const walk=el=>[el,...el.children.flatMap(walk)];
  assert.equal(walk(modal).filter(el=>el.tagName==='img').length,8);
  assert.equal(walk(modal).filter(el=>el.tagName==='details'&&el.open).length,1);
  const photoJump=walk(modal).find(el=>el.tagName==='input'&&el.max===201);photoJump.value=201;photoJump.onchange();
  assert.equal(walk(modal).filter(el=>el.tagName==='img').length,1);
  assert.equal(walk(modal).find(el=>el.className==='lp-filename').textContent,'photo-200.jpg');
  assert.equal(walk(modal).find(el=>el.textContent==='下一張').disabled,true);
  if(mobile){
    const page=fixture(ui);ui.plus.spanPhoto(page,5,0,2);
    const cv=new Element(),cell=new Element();cell.dataset.id=5;
    cv.querySelectorAll=selector=>selector==='.cell'?[cell]:[];
    ui.document.querySelectorAll=selector=>selector==='.canvasBox'?[cv]:[];
    ui.ctx.render();ui.ctx.render();
    assert.equal(cell.children.filter(el=>el.className==='lp-free-handle').length,1,'repeated decoration must not duplicate gesture handlers/handles');
  }
  const integration=environment(mobile,true,true);await Promise.resolve();assert.ok(integration.plus);
  integration.ctx._testPhotos=ctx.photos;
  vm.runInContext("photos=_testPhotos;nextId=10;const smokePage={regions:[{photoIds:photos.map(p=>p.id),stars:[],cands:[],candIdx:0}],cells:{},offsets:{},freeMode:false,free:{}};pages=[smokePage];relayoutPage(smokePage);render();LayoutPlus.spanPhoto(smokePage,5,0,2);render();",integration.ctx);
  console.log(`${mobile?'mobile':'desktop'}: region locks, cross-page geometry, focus, undo/redo, original-file drafts, templates, compact UI initialization PASS`);
}
(async()=>{await check(false);await check(true);})().catch(e=>{console.error(e);process.exitCode=1;});
