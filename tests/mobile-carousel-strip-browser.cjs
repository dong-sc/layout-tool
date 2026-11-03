// Mobile carousel modelled on SCRL / Instagram: one horizontal strip that grows to the right,
// "+ add one" at the end, photos that cross a seam, and pages <-> slides when switching modes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.LAYOUT_TEST_URL||'http://127.0.0.1:8765/';
const out=process.argv[2]||path.join(__dirname,'../evidence/mobile-carousel-strip');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();const results=[];
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__shared=[];navigator.canShare=()=>true;navigator.share=async d=>{window.__shared.push(d.files.map(f=>f.name));};});
 await page.goto(base+'m/');await page.locator('.lp-dock').waitFor();
 const cdp=await page.context().newCDPSession(page);
 const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(([x,y],id)=>({x,y,id}))});
 const swipe=async(x0,y0,x1,y1,steps=8)=>{await touch('touchStart',[[x0,y0]]);for(let i=1;i<=steps;i++)await touch('touchMove',[[x0+(x1-x0)*i/steps,y0+(y1-y0)*i/steps]]);await touch('touchEnd',[]);await page.waitForTimeout(350);};
 const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=800;const x=c.getContext('2d');x.fillStyle='#6a8f5a';x.fillRect(0,0,1200,800);return c.toDataURL('image/jpeg').split(',')[1];});
 let serial=0;const files=n=>Array.from({length:n},()=>({name:`c-${serial++}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from(jpeg,'base64')}));
 const state=()=>page.evaluate(()=>({pages:pages.length,panels,spans:pages[0]?.regions.map(r=>r.span||1),counts:pages[0]?.regions.map(r=>r.photoIds.length),placed:pages.flatMap(allIds).length,pool:photos.length-pages.flatMap(allIds).length,panel:centeredPanel(),ty:view.ty}));

 // More photos than fit: the strip grows to the right instead of starting a second carousel.
 await page.locator('[data-p=igc]').click();assert.equal(await page.locator('#panelCtl').textContent(),'−3 張＋','the slide stepper says 張, not 頁');
 await page.locator('#file').setInputFiles(files(30));await page.waitForFunction(()=>pages.length===1);await page.waitForTimeout(300);
 let s=await state();assert.deepEqual([s.pages,s.panels,s.placed,s.pool],[1,4,30,0],'30 photos: one strip, grown to 4 slides');
 const sb=await page.locator('#stage').boundingBox(),cx=sb.x+sb.width/2,cy=sb.y+sb.height/2;
 await swipe(cx,cy-150,cx,cy+150);s=await state();assert.equal(s.ty,0,'no vertical page change inside a carousel');
 results.push('one strip that grows to the right, stepper in 張, no vertical paging PASS');

 // "+ add one" sits after the last slide; it adds the chosen photos as a new slide at the end.
 for(let i=0;i<4;i++)await swipe(cx+120,cy,cx-120,cy);
 const ghost=await page.locator('#railAdd').boundingBox();assert.ok(ghost&&ghost.x+ghost.width<=390&&ghost.x>=0,'"+ add one" comes into view after the last slide');
 const before=(await state()).counts;
 const chooser=page.waitForEvent('filechooser');await page.locator('#railAdd').click();await (await chooser).setFiles(files(3));await page.waitForTimeout(500);
 s=await state();assert.equal(s.panels,5);assert.deepEqual(s.counts,[...before,3],'existing slides are untouched; the new photos are the new last slide');assert.equal(s.panel,4,'the view moves to the new slide');
 await page.screenshot({path:path.join(out,'1-added-slide.png')});
 results.push('"+ 加一張" after the last slide adds a new slide without reshuffling the others PASS');

 // A photo can cross the seam between two slides; the others are laid out around it, and it can be undone.
 await page.locator('#railDots .dot').nth(0).click();await page.waitForTimeout(300);
 const id=await page.evaluate(()=>pages[0].regions[0].photoIds[1]),cell=page.locator(`.canvasBox .cell[data-id="${id}"]`);
 await cell.click();await page.waitForTimeout(150);assert.equal(await page.locator('#opSeamTxt').textContent(),'橫跨接縫（和右邊一張連起來）');
 await page.locator('#opSeam').click();await page.waitForTimeout(400);
 const seam=await page.evaluate(id=>{const p=pages[0],c=p.cells[id],pw=settings().w/panels,boxes=Object.values(p.cells);
   const overlap=boxes.some((a,i)=>boxes.some((b,j)=>i<j&&a.x<b.x+b.w-1e-6&&b.x<a.x+a.w-1e-6&&a.y<b.y+b.h-1e-6&&b.y<a.y+a.h-1e-6));
   return {crosses:c.x+c.w*.25<=pw&&pw<=c.x+c.w*.75,overlap,spans:p.regions.map(r=>r.span||1),placed:allIds(p).length};},id);
 assert.equal(seam.crosses,true,'the photo crosses the seam with at least a quarter on each side');assert.equal(seam.overlap,false,'no photo covers another');
 assert.deepEqual(seam.spans,[2,1,1,1]);assert.equal(seam.placed,33);
 await page.screenshot({path:path.join(out,'2-seam.png')});
 await page.locator(`.canvasBox .cell[data-id="${id}"]`).click();await page.waitForTimeout(150);assert.equal(await page.locator('#opSeamTxt').textContent(),'取消橫跨接縫');
 await page.locator('#opSeam').click();await page.waitForTimeout(300);s=await state();assert.deepEqual(s.spans,[1,1,1,1,1]);assert.deepEqual(s.counts,[...before,3],'undoing the seam restores each slide');
 results.push('cross the seam: photo spans two slides, nothing overlaps, undo restores the slides PASS');

 // Export: one image per slide, in order (the seam photo is simply cut at the slide edge).
 await page.locator('.lp-dock [data-action=download]').click();await page.waitForFunction(()=>window.__shared.length===1);
 assert.deepEqual(await page.evaluate(()=>window.__shared[0]),Array.from({length:5},(_,i)=>`排版-01-輪播-${String(i+1).padStart(2,'0')}.jpg`));
 results.push('saves one image per slide, in order PASS');

 // Delete this slide (tools), stepper −/＋ work at the end of the strip; removed photos go back to the photo strip.
 await page.locator('#railDots .dot').nth(1).click();await page.waitForTimeout(300);
 await page.locator('.lp-dock-more').click();assert.equal(await page.locator('[data-action=delpage]').textContent(),'刪除這一張');
 await page.locator('[data-action=delpage]').click();await page.waitForTimeout(300);s=await state();
 assert.equal(s.panels,4);assert.deepEqual(s.counts,[before[0],before[2],before[3],3]);assert.equal(s.pool,before[1]);
 await page.locator('#pool .thumb').first().click();await page.waitForTimeout(200);s=await state();assert.equal(s.counts[3],4,'a leftover photo joins the last slide');
 await page.locator('#pPlus').click();await page.waitForTimeout(200);s=await state();assert.deepEqual([s.panels,s.counts[4]],[5,0],'＋ adds an empty slide at the end');assert.match(await page.locator('#igInfo').textContent(),/空白的一張/);
 await page.locator('#pMinus').click();await page.waitForTimeout(200);s=await state();assert.equal(s.panels,4,'− removes the last slide');
 results.push('delete this slide, leftover photo fills the last slide, ＋/− at the end PASS');

 // Pages <-> slides: three single pages become one three-slide carousel and back again.
 await page.evaluate(()=>{pages.splice(0);photos.splice(0);render();});await page.locator('[data-p=ig45]').click();
 await page.locator('#file').setInputFiles(files(6));await page.waitForFunction(()=>pages.length===1);
 await page.evaluate(()=>{const p0=pages[0],ids=allIds(p0);p0.regions=[{photoIds:ids.slice(0,2),stars:[],cands:[],candIdx:0}];relayoutPage(p0);placePhotos(ids.slice(2,4),true);placePhotos(ids.slice(4),true);cur=0;render();});
 const groups=await page.evaluate(()=>pages.map(allIds));assert.equal(groups.length,3);
 await page.locator('[data-p=igc]').click();await page.waitForTimeout(300);s=await state();
 assert.deepEqual([s.pages,s.panels],[1,3],'three pages become one strip of three slides');assert.deepEqual(await page.evaluate(()=>pages[0].regions.map(r=>r.photoIds)),groups,'each page becomes one slide, in order');
 await page.locator('[data-p=ig45]').click();await page.waitForTimeout(300);assert.deepEqual(await page.evaluate(()=>pages.map(allIds)),groups,'switching back splits the slides into the same pages');
 results.push('pages become slides and back, photos and order kept PASS');

 assert.deepEqual(errors,[]);await browser.close();
 fs.writeFileSync(path.join(out,'mobile-carousel-strip-results.json'),JSON.stringify(results,null,2));console.log(results.join('\n'));
})().catch(e=>{console.error(e);process.exit(1)});
