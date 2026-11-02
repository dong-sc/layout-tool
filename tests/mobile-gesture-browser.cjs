// Mobile photo area: one finger follows a rail, two fingers zoom the work (never the web page).
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.LAYOUT_TEST_URL||'http://127.0.0.1:8765/';
const out=process.argv[2]||path.join(__dirname,'../evidence/mobile-gesture');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();const results=[];
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'m/');await page.locator('.lp-dock').waitFor();
 // Real touch input through the DevTools protocol, so pointer events arrive exactly as on a phone.
 const cdp=await page.context().newCDPSession(page);
 const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(([x,y],id)=>({x,y,id}))});
 const swipe=async(x0,y0,x1,y1,steps=8)=>{await touch('touchStart',[[x0,y0]]);for(let i=1;i<=steps;i++)await touch('touchMove',[[x0+(x1-x0)*i/steps,y0+(y1-y0)*i/steps]]);await touch('touchEnd',[]);await page.waitForTimeout(350);};
 const pinch=async(cx,cy,d0,d1,steps=8)=>{await touch('touchStart',[[cx-d0/2,cy],[cx+d0/2,cy]]);for(let i=1;i<=steps;i++){const d=d0+(d1-d0)*i/steps;await touch('touchMove',[[cx-d/2,cy],[cx+d/2,cy]]);}await touch('touchEnd',[]);await page.waitForTimeout(350);};
 const state=()=>page.evaluate(()=>({s:view.s,tx:view.tx,ty:view.ty,fit:fitScale(),panel:centeredPanel(),cur,pages:pages.length,pageZoom:visualViewport.scale}));
 const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=1200;const x=c.getContext('2d');x.fillStyle='#4a7a8c';x.fillRect(0,0,900,1200);return c.toDataURL('image/jpeg').split(',')[1];});
 const files=n=>Array.from({length:n},(_,i)=>({name:`g-${i}-${Math.random()}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from(jpeg,'base64')}));

 // Carousel: one panel fills the area; a horizontal swipe snaps to the next panel.
 await page.locator('[data-p=igc]').click();await page.locator('#file').setInputFiles(files(9));await page.waitForFunction(()=>pages.length===1);await page.waitForTimeout(300);
 const sb=await page.locator('#stage').boundingBox(),cx=sb.x+sb.width/2,cy=sb.y+sb.height/2;
 let s=await state();assert.equal(s.panel,0);assert.ok(Math.abs(s.s-s.fit)<1e-6&&s.fit>1,'a carousel opens with one panel filling the area');
 assert.equal(await page.locator('#railDots .num').textContent(),'1 / 3');
 await swipe(cx+120,cy,cx-80,cy);s=await state();assert.equal(s.panel,1,'swipe left snaps to the next panel');assert.equal(s.ty,0);
 await swipe(cx-60,cy,cx+60,cy,3);s=await state();assert.equal(s.panel,0,'a quick flick back returns to the previous panel');
 await swipe(cx,cy-120,cx,cy+120);s=await state();assert.equal(s.panel,0);assert.equal(s.ty,0,'a vertical swipe never drifts a carousel off its rail');
 await page.locator('#railDots .dot').nth(2).click();await page.waitForTimeout(300);assert.equal((await state()).panel,2,'tapping a dot jumps to that panel');
 results.push('carousel rail: fills one panel, swipe/flick snap, no vertical drift, dots jump PASS');

 // Pinching anywhere (here over the bottom buttons) zooms the work, never the page.
 const dock=await page.locator('.lp-dock').boundingBox();
 await pinch(dock.x+dock.width/2,dock.y+dock.height/2,60,200);s=await state();
 assert.ok(s.s>s.fit*2,'pinching over the buttons zooms the layout');assert.equal(s.pageZoom,1,'the web page itself never zooms');
 const zoomed={...s};await swipe(cx,cy-80,cx,cy+80);s=await state();assert.equal(s.ty,zoomed.ty,'zoomed carousel: one finger stays on the horizontal rail');
 await swipe(cx+60,cy,cx-60,cy);s=await state();assert.ok(Math.abs(s.tx-(zoomed.tx-120))<2||s.tx<zoomed.tx,'zoomed carousel: one finger pans along the rail');
 await pinch(cx,cy,300,20,10);s=await state();assert.equal(s.s,1,'pinching in all the way shows the whole carousel');assert.match(await page.locator('#railDots .num').textContent(),/總覽/);
 await page.locator('#zoomReset').click();await page.waitForTimeout(300);s=await state();assert.ok(Math.abs(s.s-s.fit)<1e-6,'↺ returns to one panel');
 results.push('pinch anywhere zooms the work, page zoom stays 1, zoomed rail, overview and reset PASS');

 // Single pages: vertical swipes flip pages; zoomed, one finger pans inside the page until its edge.
 await page.locator('[data-p=ig45]').click();await page.waitForTimeout(200);
 await page.locator('#file').setInputFiles(files(3));await page.waitForFunction(()=>photos.length===12);await page.waitForTimeout(300);
 await page.evaluate(()=>{const used=new Set(pages.flatMap(allIds));const rest=photos.filter(ph=>!used.has(ph.id)).map(ph=>ph.id);placePhotos(rest,true);cur=0;resetView();render();});
 await page.waitForTimeout(200);assert.equal((await state()).pages,2);assert.equal(await page.locator('#pageDots').textContent(),'1 / 2');
 assert.equal(await page.locator('#prevPg').isVisible(),false,'paging buttons are gone');
 await swipe(cx,cy+150,cx,cy-150);s=await state();assert.equal(s.cur,1,'swipe up shows the next page');assert.equal(s.ty,0);
 await swipe(cx,cy+150,cx,cy-150);assert.equal((await state()).cur,1,'the last page stays put');
 await swipe(cx,cy-150,cx,cy+150);assert.equal((await state()).cur,0,'swipe down shows the previous page');
 await swipe(cx+120,cy,cx-120,cy);s=await state();assert.equal(s.cur,0);assert.equal(s.tx,0,'a sideways swipe does nothing on a single page');
 await pinch(cx,cy,80,240);s=await state();assert.ok(s.s>2);
 await swipe(cx,cy+60,cx,cy-60);let z=await state();assert.equal(z.cur,0,'zoomed: one finger pans inside the page instead of flipping');assert.ok(z.ty<s.ty);
 for(let i=0;i<3&&(await state()).cur===0;i++)await swipe(cx,cy+200,cx,cy-200);
 z=await state();assert.equal(z.cur,1,'at the bottom edge, one more swipe flips to the next page');assert.equal(z.s,1);
 results.push('single pages: vertical flip with edges, sideways ignored, zoomed pan then edge flip PASS');

 // Delete-this-set moved into the tools sheet.
 await page.locator('.lp-dock-more').click();await page.locator('[data-action=delpage]').click();await page.waitForTimeout(200);
 assert.equal((await state()).pages,1);assert.equal(await page.locator('#pageDots').isVisible(),false);
 results.push('delete this set from the tools sheet PASS');

 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'final.png')});await browser.close();
 fs.writeFileSync(path.join(out,'mobile-gesture-results.json'),JSON.stringify(results,null,2));console.log(results.join('\n'));
})().catch(e=>{console.error(e);process.exit(1)});
