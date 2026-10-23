const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.LAYOUT_TEST_ROOT || path.join(__dirname, '..');
const fn = (s, name) => s.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n\\}'))[0];

async function check(file, mobile) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(m[1]);
  // Actual candidate generator: ordered binary traversal must remain stable while changing layout.
  const ordered = vm.createContext({igMeta:()=>({panels:6}), $:()=>({checked:true})});
  const sig = mobile
    ? "const treeSig = n => n.leaf !== undefined ? 'L'+n.leaf : n.dir+'('+treeSig(n.a)+','+treeSig(n.b)+')';"
    : fn(html,'treeSig');
  vm.runInContext(['aspectOf','layoutTree','randTree','genCandidates'].map(name=>fn(html,name)).join('\n')+'\n'+sig,ordered);
  const leaves = tree => tree.leaf !== undefined ? [tree.leaf] : [...leaves(tree.a),...leaves(tree.b)];
  for (let n=2;n<=8;n++) {
    const ratios=Array.from({length:n},(_,i)=>i===n-1 ? 1365/2048 : 2048/1365);
    const candidates=ordered.genCandidates(ratios,[],108,135,0);
    assert.ok(candidates.length>0);
    for(const c of candidates) assert.deepEqual(leaves(c.tree),Array.from({length:n},(_,i)=>i));
  }
  // Exercise the actual normalization code for every panel count and uneven photo counts.
  for (let n = 2; n <= 20; n++) for (let count = n; count <= 60; count++) {
    const ids = Array.from({length:count}, (_,i)=>i+1);
    const p = {regions:[{photoIds:ids, stars:[1,count]}]};
    const ctx = vm.createContext({p, igMeta:()=>({panels:n}), allIds:p=>p.regions.flatMap(r=>r.photoIds)});
    vm.runInContext(fn(html,'normalizeRegions')+';normalizeRegions(p)',ctx);
    const sizes = p.regions.map(r=>r.photoIds.length);
    assert.equal(p.regions.length,n);
    assert.ok(Math.min(...sizes)>0, file+': unexpected blank panel');
    assert.ok(Math.max(...sizes)-Math.min(...sizes)<=1);
    assert.deepEqual(Array.from(p.regions.flatMap(r=>r.photoIds)),ids);
    assert.deepEqual(Array.from(p.regions.flatMap(r=>r.stars)),[1,count]);
  }
  // Run the actual JPEG exporter with canvas/encoding mocks and a photo crossing a seam.
  for (const n of [2,3,10,20]) for (const height of [1080,1350,1440]) {
    const records=[], moves=[], draws=[], downloads=[];
    const rects = {1:{x:50,y:0,w:120,h:100},2:{x:180,y:0,w:30,h:100}};
    const page={regions:[{photoIds:[1,2]}],cells:rects};
    const els={'#exportBtn':{},'#dpi':{value:300},'#qual':{value:90},'#bgMode':{value:'white'}};
    const context={
      exportBusy:false,loadBusy:false,
      pages:[page], settings:()=>({w:108*n,h:height/10}),
      igMeta:()=>({panels:n,pw:1080,ph:height}),
      $:s=>els[s] || {}, allIds:p=>p.regions.flatMap(r=>r.photoIds),
      photoById:id=>({id}), drawRect:(id,r)=>r, getOffset:()=>({ox:.5,oy:.5,z:1}),
      exportCellsOf:p=>Object.entries(p.cells).map(([id,rect])=>({id,rect,ox:.5,oy:.5})),
      cropCanvas:async ph=>({width:1200,height:1000,id:ph.id}),
      drawSigOn:()=>{}, bgModeOf:()=> 'white', bgPhotoOf:()=>null,
      jpegBlob:async cv=>{ records.push([cv.width,cv.height]);return new Blob(['test']); },
      showOverlay:()=>{},hideOverlay:()=>{}, alert:message=>{throw Error(message)},
      setTimeout:cb=>cb(),navigator:{},window:{},Blob,File,
      document:{createElement:()=>({width:0,height:0,getContext:()=>({
        translate:x=>moves.push(x),fillRect:()=>{},drawImage:cv=>draws.push(cv.id)
      })})},
      triggerDownload:(blob,name)=>downloads.push(name),
      JSZip:class {file(name){this.names??=[];this.names.push(name);return this;}
        async generateAsync(){assert.deepEqual([...this.names].sort(),this.names);return new Blob(['zip']);}}
    };
    const ctx=vm.createContext(context);
    if(mobile){
      const code=html.match(/\$\('#exportBtn'\)\.onclick = async \(\) => \{[^]*?\n\};/)[0];
      vm.runInContext(code,ctx);await Promise.all([context.$('#exportBtn').onclick(),context.$('#exportBtn').onclick()]);
    }else{
      vm.runInContext(fn(html,'doExport'),ctx);await Promise.all([ctx.doExport('jpeg'),ctx.doExport('jpeg')]);
    }
    assert.equal(records.length,n);
    assert.ok(records.every(([w,h])=>w===1080 && h===height));
    assert.equal(moves[1],-1080);
    assert.equal(draws.filter(id=>id==='1').length,2,'cross-seam photo must appear on both tiles');
    assert.equal(downloads.length,1,'Concurrent exports must produce one download');
    if(mobile) await context.$('#exportBtn').onclick(); else await ctx.doExport('jpeg');
    assert.equal(downloads.length,2,'Export lock must release after completion');
    if(n===2 && height===1080){
      const encode=context.jpegBlob;
      context.jpegBlob=async()=>{throw Error('synthetic encoding failure');};
      await assert.rejects(mobile ? context.$('#exportBtn').onclick() : ctx.doExport('jpeg'),/synthetic encoding failure/);
      assert.equal(ctx.exportBusy,false,'Export lock must release after failure');
      context.jpegBlob=encode;
      if(mobile) await context.$('#exportBtn').onclick(); else await ctx.doExport('jpeg');
      assert.equal(downloads.length,3,'Export must work after failure');
    }
  }
  // Null toBlob result must reject, never create a corrupt File or ZIP entry.
  const ctx=vm.createContext({});
  vm.runInContext(fn(html,'jpegBlob'),ctx);
  await assert.rejects(ctx.jpegBlob({toBlob:cb=>cb(null)},.9),/無法產生圖片/);
  console.log(file+': syntax, 2–20 panel distribution, export dimensions, ordering, seam geometry, null encoding PASS');
}
(async()=>{await check('index.html',false);await check('m/index.html',true);})().catch(e=>{console.error(e);process.exitCode=1;});
