const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=process.argv[2]||path.join(__dirname,'../evidence/protected-area');fs.mkdirSync(out,{recursive:true});
const base=process.env.LAYOUT_TEST_URL||'http://127.0.0.1:8767/';
async function verify(page){return page.evaluate(()=>{
 const p=pages[0],area=LayoutPlus.protectedRect(p),list=LayoutPlus.cells(p);
 const overlap=r=>r.x<area.x+area.w-1e-6&&r.x+r.w>area.x+1e-6&&r.y<area.y+area.h-1e-6&&r.y+r.h>area.y+1e-6;
 return {area:p.protectedArea,rect:area,count:list.length,overlaps:list.filter(c=>overlap(c.rect)).length};
});}
async function saveDownload(page,action,file){const event=page.waitForEvent('download',{timeout:60000});await action();const d=await event;assert.equal(await d.failure(),null);await d.saveAs(path.join(out,file));}
(async()=>{const browser=await chromium.launch();const results=[],manifest=[];
for(const mobile of [false,true]){
 const name=mobile?'mobile':'desktop',page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+(mobile?'m/':''));await page.locator('.lp-bar').waitFor();assert.equal(await page.locator('[data-action=protect]').isEnabled(),false);
 if(mobile)await page.locator('[data-p=ig45]').click();else await page.locator('#preset').selectOption('ig45');
 const image=await page.evaluate(()=>{const cv=document.createElement('canvas');cv.width=1200;cv.height=900;const c=cv.getContext('2d');c.fillStyle='#397689';c.fillRect(0,0,1200,900);c.fillStyle='#d5b877';c.fillRect(80,80,500,700);c.fillStyle='#c8ded5';c.fillRect(630,140,450,600);c.fillStyle='#172e37';c.font='72px sans-serif';c.fillText('TEST PHOTO',160,460);return cv.toDataURL('image/jpeg').split(',')[1];});
 await page.locator('#file').setInputFiles(Array.from({length:12},(_,i)=>({name:`protected-${i}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from(image,'base64')})));
 await page.waitForFunction(()=>photos.length===12&&document.querySelector('#overlay').style.display==='none');await page.locator('#selAll').click();await page.locator('[data-action=make]').click();await page.locator('[data-action=pool]').click();await page.locator('[data-action=fit]').click();
 await page.locator('[data-action=protect]').click();await page.getByRole('button',{name:'新增矩形保護區',exact:true}).click();
 for(const [label,value]of [['左右 %','15'],['寬度 %','70'],['上下 %','30'],['高度 %','40']]){await page.getByLabel(label,{exact:true}).fill(value);await page.getByLabel(label,{exact:true}).press('Tab');}
 await page.getByLabel('保護區底色',{exact:true}).fill('#f2ede2');await page.getByLabel('保護區底色',{exact:true}).dispatchEvent('change');await page.screenshot({path:path.join(out,`${name}-settings.png`)});await page.locator('dialog .lp-close').click();
 let checked=await verify(page);assert.equal(checked.overlaps,0);assert.equal(checked.count,12);assert.equal(checked.area.y,.3);
 await page.screenshot({path:path.join(out,`${name}-automatic.png`)});
 await page.evaluate(()=>pages[0].regions.flatMap(r=>r.photoIds).forEach(id=>LayoutPlus.confirmPhoto(pages[0],id)));
 for(let i=0;i<10;i++){await page.locator('[data-action=shuffle]').click();checked=await verify(page);assert.equal(checked.overlaps,0);assert.equal(checked.count,12);}
 const baseArea=JSON.stringify(checked.area);await page.locator('[data-action=protect]').click();await page.getByRole('button',{name:'在畫布拖動／縮放',exact:true}).click();
 const areaBox=await page.locator('.canvasBox .lp-protected-area').boundingBox(),canvas=await page.locator('.canvasBox').boundingBox();
 await page.mouse.move(areaBox.x+areaBox.width*.55,areaBox.y+areaBox.height*.5);await page.mouse.down();await page.mouse.move(areaBox.x+areaBox.width*.55+22,areaBox.y+areaBox.height*.5+18,{steps:5});await page.mouse.up();
 checked=await verify(page);assert.equal(checked.overlaps,0);assert.ok(Math.abs(checked.area.x-.15-22/canvas.width)<.005,'protected drag x follows actual viewport zoom');assert.ok(Math.abs(checked.area.y-.3-18/canvas.height)<.005);
 const handle=await page.locator('.lp-protected-handle').boundingBox(),prior=checked.area;
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+12,handle.y+handle.height/2+10,{steps:5});await page.mouse.up();checked=await verify(page);assert.equal(checked.overlaps,0);assert.ok(checked.area.w>prior.w);assert.ok(checked.area.h>prior.h);
 await page.locator('.lp-protected-label').getByText('完成',{exact:true}).click();
 const changedArea=JSON.stringify(checked.area);await page.locator('[data-action=undo]').click();assert.notEqual(JSON.stringify((await verify(page)).area),changedArea);await page.locator('[data-action=redo]').click();assert.equal(JSON.stringify((await verify(page)).area),changedArea);
 assert.ok(await page.evaluate(()=>allIds(pages[0]).some(id=>LayoutPlus.reviewState(pages[0],id)==='changed')));
 // Switch into the real free editor and try moving a photo into the protected rectangle.
 await page.locator('[data-action=edit]').click();await page.getByText('自由編排與精確位置',{exact:true}).click();await page.getByRole('button',{name:'啟用自由編排',exact:true}).click();await page.locator('dialog .lp-close').click();
 const target=await page.evaluate(()=>{const p=pages[0];return LayoutPlus.cells(p).sort((a,b)=>b.rect.w*b.rect.h-a.rect.w*a.rect.h)[0].id;});
 const cell=await page.locator('.cell[data-id="'+target+'"]').boundingBox(),zone=await page.locator('.canvasBox .lp-protected-area').boundingBox();
 await page.mouse.move(cell.x+cell.width*.5,cell.y+cell.height*.5);await page.mouse.down();await page.mouse.move(zone.x+zone.width*.5,zone.y+zone.height*.5,{steps:8});await page.mouse.up();assert.equal((await verify(page)).overlaps,0);
 await page.screenshot({path:path.join(out,`${name}-canvas.png`)});
 // Raster preview and real JPEG output contain a blank solid area, never the editor label.
 const preview=await page.evaluate(async()=>{const cv=await LayoutPlus.paintTile(pages[0],0,{width:1080});const r=LayoutPlus.protectedRect(pages[0]),st=settings(),x=Math.floor((r.x+r.w/2)/st.w*cv.width),y=Math.floor((r.y+r.h/2)/st.h*cv.height);return {pixel:Array.from(cv.getContext('2d').getImageData(x,y,1,1).data),area:pages[0].protectedArea,st};});assert.deepEqual(preview.pixel,[242,237,226,255]);
 await saveDownload(page,async()=>{await page.locator('[data-action=download]').click();await page.getByRole('button',{name:'仍要下載',exact:true}).click();},`${name}.jpg`);
 manifest.push({name,area:preview.area,jpeg:`${name}.jpg`,pdf:mobile?null:'desktop.pdf',pptx:mobile?null:'desktop.pptx'});
 if(!mobile){for(const [button,file]of [['下載 PDF','desktop.pdf'],['下載 PowerPoint','desktop.pptx']])await saveDownload(page,async()=>{await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name:button,exact:true}).click();},file);}
 await page.evaluate(()=>LayoutPlus.saveDraft());const saved=await page.evaluate(()=>JSON.stringify(LayoutPlus.snapshot()));await page.reload();await page.getByRole('button',{name:'繼續上次草稿',exact:true}).click();await page.waitForFunction(()=>pages.length===1);assert.equal(await page.evaluate(()=>JSON.stringify(LayoutPlus.snapshot())),saved);
 await saveDownload(page,async()=>{await page.locator('[data-action=save]').click();await page.getByRole('button',{name:'下載專案到我的裝置',exact:true}).click();},`${name}.dong.zip`);
 await page.locator('[data-action=save]').click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'開啟專案檔',exact:true}).click();await (await chooser).setFiles(path.join(out,`${name}.dong.zip`));await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(await page.evaluate(()=>JSON.stringify(LayoutPlus.snapshot())),saved);
 // Carousel placement and ratio changes preserve relative panel coordinates.
 if(mobile)await page.locator('[data-p=igc]').click();else await page.locator('#preset').selectOption('igc');await page.locator('[data-action=protect]').click();await page.getByLabel('輪播第幾張',{exact:true}).selectOption('1');await page.locator('dialog .lp-close').click();
 const coordinates=JSON.stringify((await verify(page)).area);await page.locator('#carouselRatio').selectOption('1080');assert.equal(JSON.stringify((await verify(page)).area),coordinates);assert.equal((await verify(page)).overlaps,0);await page.locator('[data-action=fit]').click();await page.screenshot({path:path.join(out,`${name}-carousel.png`)});
 for(const format of ['ig34','ig45','ig11','igst']){const state=await page.evaluate(format=>{const from=settings(),to={...from,h:{ig34:144,ig45:135,ig11:108,igst:192}[format]},p=LayoutPlus.scaledPage(pages[0],from,to),r=LayoutPlus.protectedRect(p,to);return {r,overlaps:LayoutPlus.cells(p).filter(c=>c.rect.x<r.x+r.w-1e-6&&c.rect.x+c.rect.w>r.x+1e-6&&c.rect.y<r.y+r.h-1e-6&&c.rect.y+c.rect.h>r.y+1e-6).length};},format);assert.equal(state.overlaps,0,format);}
 await page.locator('[data-action=protect]').click();await page.getByRole('button',{name:'移除保護區',exact:true}).click();await page.locator('dialog .lp-close').click();assert.equal(await page.locator('.canvasBox .lp-protected-area').count(),0);assert.deepEqual(errors,[]);
 results.push(`${name}: 12 photos, 10 shuffles, drag/resize/undo, free-photo exclusion, exact blank preview, real JPEG${mobile?'': '/PDF/PPTX'}, draft and project reload, carousel ratios/multiformat, removal PASS`);await page.close();
}
await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));fs.writeFileSync(path.join(out,'exports.json'),JSON.stringify(manifest,null,2));console.log(results.join('\n'));
})().catch(e=>{console.error(e);process.exit(1)});
