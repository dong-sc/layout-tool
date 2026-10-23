const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = process.env.LAYOUT_TEST_ROOT || root;
// Functions are extracted by their next top-level sibling to keep nested try/finally intact.
function between(s, start, end) { return s.slice(s.indexOf(start), s.indexOf(end, s.indexOf(start))); }
function env(failure = '') {
  const urls = new Set(), canvases = [], bitmaps = [];
  let decoded = 0;
  const ctx = vm.createContext({
    File, PREVIEW_PX:1500, photos:[],nextId:1,
    URL:{createObjectURL(){const u='blob:'+urls.size;urls.add(u);return u;},revokeObjectURL:u=>urls.delete(u)},
    Image:class {async decode(){if(failure==='image')throw Error('image failed');}},
    decodeFile:async()=>{decoded++;if(failure==='second' && decoded===2)throw Error('second failed');const b={width:6000,height:4000,closed:0,close(){this.closed++;}};bitmaps.push(b);return b;},
    jpegBlob:async()=>{if(failure==='encode')throw Error('encode failed');return new Blob(['preview']);},
    document:{createElement(){const c={width:0,height:0,getContext:()=>({fillRect(){},drawImage(){if(failure==='draw')throw Error('draw failed');}}),toBlob:cb=>cb(failure==='null'?null:new Blob(['preview']))};canvases.push(c);return c;}},
  });
  return {ctx,urls,canvases,bitmaps};
}
(async()=>{
  for (const file of ['index.html','m/index.html']) {
    const html=fs.readFileSync(path.join(source,file),'utf8');
    const load=between(html,'async function loadOne(file){','/* ================= overlay');
    const crop=between(html,'async function cropCanvas(',file==='index.html'?'/* 匯出用格子':'function blurDraw(');
    for (const failure of ['image','null','draw']) {
      const e=env(failure);vm.runInContext(load,e.ctx);
      await assert.rejects(e.ctx.loadOne(new File(['synthetic'],'test.jpg',{type:'image/jpeg'})));
      assert.equal(e.urls.size,0,`${file} ${failure}: preview URLs leaked`);
      assert.equal(e.bitmaps[0].closed,1,`${file} ${failure}: bitmap leaked`);
      assert.equal(e.ctx.photos.length,0,'Failed import must not create photo');
      assert.ok(e.canvases.every(c=>c.width*c.height===0),'Failed preview canvas must be released');
    }
    const e=env('draw');vm.runInContext(crop,e.ctx);
    await assert.rejects(e.ctx.cropCanvas({file:new File(['synthetic'],'test.jpg')},1,100,.5,.5,1));
    assert.equal(e.bitmaps[0].closed,1,`${file}: failed crop bitmap leaked`);
    const ok=env();vm.runInContext(load,ok.ctx);await ok.ctx.loadOne(new File(['synthetic'],'test.jpg'));
    assert.equal(ok.ctx.photos.length,1);assert.equal(ok.urls.size,1,'Successful preview must remain available');
    assert.equal(ok.canvases[0].width*ok.canvases[0].height,0,'Preview canvas backing store must be released');
    console.log(`${file}: image/null/draw failures reclaim resources; successful preview retained PASS`);
  }
  const extension=fs.readFileSync(path.join(source,'editor-plus.js'),'utf8');
  const code=between(extension,'  async function importAssets(records){','  async function restoreDraft');
  for(const failure of ['second','image','encode','draw']){
    const e=env(failure);vm.runInContext(code,e.ctx);
    const records=[1,2].map(id=>({id,file:new File(['synthetic'],'test.jpg')}));
    await assert.rejects(e.ctx.importAssets(records));
    assert.equal(e.urls.size,0,`draft ${failure}: staged URLs leaked`);
    assert.ok(e.bitmaps.every(b=>b.closed===1),`draft ${failure}: bitmap leaked`);
    assert.ok(e.canvases.every(c=>c.width*c.height===0),`draft ${failure}: canvas leaked`);
    console.log(`draft restore ${failure}: staged preview URLs=0, unclosed bitmaps=0, canvas pixels=0 PASS`);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
