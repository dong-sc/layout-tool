const {chromium}=require('playwright');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
const out=process.argv[2]||path.join(__dirname,'../evidence/exports');fs.mkdirSync(out,{recursive:true});
const colors=['#d42c27','#278c42','#3156cc','#24a6ad','#d23dac','#e3b523','#7542a5'];
async function download(page,action,file){const event=page.waitForEvent('download',{timeout:60000});await action();const result=await event;const error=await result.failure();assert.equal(error,null);await result.saveAs(path.join(out,file));return result.suggestedFilename();}
async function chooseMulti(page){
 await page.evaluate(()=>LayoutPlus.setStep(4));await page.locator('[data-action=formats]').click();
 for(const check of await page.locator('dialog input[type=checkbox]').all())await check.check();
 await page.getByRole('button',{name:/^(先選尺寸並預覽|預覽選取尺寸 →)$/}).click();
 let checked=0;while(await page.locator('dialog').evaluate(el=>el.open)&&checked<24){const confirm=page.getByRole('button',{name:'這張已檢查，繼續 →',exact:true});await confirm.click();checked++;}
 assert.equal(checked,24);assert.equal(await page.locator('dialog').evaluate(el=>el.open),false);
}
async function exportMulti(page,file){const before=await page.evaluate(()=>JSON.stringify(LayoutPlus.snapshot()));await chooseMulti(page);const name=await download(page,async()=>{await page.locator('[data-action=download]').click();if(await page.getByRole('button',{name:'仍要下載',exact:true}).count())await page.getByRole('button',{name:'仍要下載',exact:true}).click();},file);assert.equal(await page.evaluate(()=>JSON.stringify(LayoutPlus.snapshot())),before,'multiformat export must not mutate project geometry/crops');return name;}
async function office(page,kind,file){return download(page,async()=>{await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name:kind==='pdf'?'下載 PDF':'下載 PowerPoint',exact:true}).click();},file);}
(async()=>{const browser=await chromium.launch();const manifest={fixtures:colors,cases:[],errors:[]};
for(const mobile of [false,true]){
 const device=mobile?'mobile':'desktop',page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768}});
 page.on('pageerror',e=>manifest.errors.push(`${device}: ${e.message}`));page.on('dialog',async d=>{manifest.errors.push(`${device}: ${d.message()}`);await d.dismiss();});
 await page.goto((process.env.LAYOUT_TEST_URL||'http://127.0.0.1:8765/')+(mobile?'m/':''));
 if(mobile)await page.locator('[data-p=igc]').click();else await page.locator('#preset').selectOption('igc');await page.locator('#carouselRatio').selectOption('1350');
 await page.evaluate(async colors=>{const files=[];const sizes=[[3000,2000],[2000,3000],[2800,2100],[3200,1800],[1800,3200],[2400,2400],[3000,2200]];for(let i=0;i<colors.length;i++){const [w,h]=sizes[i],cv=document.createElement('canvas');cv.width=w;cv.height=h;const x=cv.getContext('2d');x.fillStyle=colors[i];x.fillRect(0,0,w,h);x.fillStyle='#111111';x.textAlign='center';x.font='bold 120px sans-serif';x.fillText('FIXTURE '+String(i+1).padStart(2,'0'),w/2,h/2);const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',.98));files.push(new File([blob],'fixture-'+String(i+1).padStart(2,'0')+'.jpg',{type:'image/jpeg'}));}await addFiles(files);},colors);await page.waitForFunction(()=>photos.length===7&&document.querySelector('#overlay').style.display==='none');
 for(const indices of [[0,1,2],[3,4,5]]){await page.evaluate(indices=>{photos.forEach((ph,i)=>ph.sel=indices.includes(i));render();},indices);await page.locator('[data-action=make]').click();}
 await page.evaluate(()=>LayoutPlus.setStep(2));assert.equal(await page.evaluate(()=>pages.length),2);
 let state=await page.evaluate(()=>({settings:settings(),panels:igMeta().panels,project:LayoutPlus.snapshot(),cells:pages.map(p=>LayoutPlus.cells(p))}));
 const basic={device,kind:'automatic',expected:[1,2,3,4,5,6],...state};basic.multiFile=`${device}-automatic-multiformat.zip`;basic.multiName=await exportMulti(page,basic.multiFile);
 await page.locator('[data-action=formats]').click();await page.getByRole('button',{name:'改用目前比例',exact:true}).click();basic.currentFile=`${device}-automatic-current.zip`;basic.currentName=await download(page,async()=>{await page.locator('[data-action=download]').click();if(await page.getByRole('button',{name:'仍要下載',exact:true}).count())await page.getByRole('button',{name:'仍要下載',exact:true}).click();},basic.currentFile);
 if(!mobile){basic.pdfFile='desktop-automatic.pdf';await office(page,'pdf',basic.pdfFile);basic.pptxFile='desktop-automatic.pptx';await office(page,'pptx',basic.pptxFile);}manifest.cases.push(basic);
 // The remaining fixture is replaced through the actual adjustment UI, preserving its slot.
 await page.locator('[data-action=edit]').click();await page.getByLabel('編輯組別').selectOption('0');await page.getByRole('button',{name:'替換照片，保留位置',exact:true}).click();await page.locator('dialog .lp-photo-list button').first().click();await page.locator('dialog .lp-close').click();
 await page.evaluate(()=>{const p=pages[0],id=allIds(p)[0];LayoutPlus.spanPhoto(p,id,0,2);p.offsets[id]={ox:.35,oy:.6,z:1.4};p.focus??={};p.focus[id]={x:.4,y:.5};render();});
 state=await page.evaluate(()=>({settings:settings(),panels:igMeta().panels,project:LayoutPlus.snapshot(),cells:pages.map(p=>LayoutPlus.cells(p))}));const free={device,kind:'free-replacement-cross-page',expected:[7,7,3,4,5,6],...state};free.multiFile=`${device}-free-multiformat.zip`;free.multiName=await exportMulti(page,free.multiFile);
 if(!mobile){free.pdfFile='desktop-free.pdf';await office(page,'pdf',free.pdfFile);free.pptxFile='desktop-free.pptx';await office(page,'pptx',free.pptxFile);}manifest.cases.push(free);await page.close();
}
assert.deepEqual(manifest.errors,[]);fs.writeFileSync(path.join(out,'export-manifest.json'),JSON.stringify(manifest,null,2));await browser.close();console.log('Actual downloads: desktop/mobile, four formats x two groups x three panels, automatic and replaced/cross-page crop cases; PDF/PPTX automatic + free PASS');})().catch(e=>{console.error(e);process.exit(1)});
