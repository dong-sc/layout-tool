// Mobile flow modelled on SCRL: choose photos -> laid out at once -> thumb actions -> save to Photos.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.LAYOUT_TEST_URL||'http://127.0.0.1:8765/';
const out=process.argv[2]||path.join(__dirname,'../evidence/mobile-scrl');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();const results=[];
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Share is stubbed: the first call fails like Safari does after a slow export, the second one succeeds.
 await page.addInitScript(()=>{window.__shares=[];navigator.canShare=()=>true;navigator.share=async data=>{window.__shares.push(data.files.length);if(window.__shares.length===1)throw new DOMException('expired gesture','NotAllowedError');};});
 await page.goto(base+'m/');await page.locator('.lp-dock').waitFor();

 // Empty state: the photo area itself is the "choose photos" button.
 const stage=await page.locator('#stage').boundingBox(),empty=await page.locator('.lp-empty-add').boundingBox();
 assert.ok(empty.width>=stage.width*.9&&empty.height>=stage.height*.8,'the empty photo area is one big add button');
 assert.equal(await page.locator('#pool').isVisible(),false,'no empty photo strip before there are photos');
 const chooser=page.waitForEvent('filechooser');await page.locator('.lp-empty-add').click();await chooser;
 const width=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(width<=390,'no sideways scrolling');
 await page.screenshot({path:path.join(out,'1-empty.png')});
 results.push('empty state is one large add button, no strip, no sideways scroll PASS');

 // Chosen photos are laid out immediately; the thumb zone holds four actions.
 const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=1200;const x=c.getContext('2d');x.fillStyle='#4a7a8c';x.fillRect(0,0,900,1200);return c.toDataURL('image/jpeg').split(',')[1];});
 await page.locator('#file').setInputFiles(Array.from({length:3},(_,i)=>({name:`s-${i}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from(jpeg,'base64')})));
 await page.waitForFunction(()=>pages.length===1&&allIds(pages[0]).length===3);
 assert.deepEqual(await page.locator('.lp-dock button').allInnerTexts(),['加入照片','換排法','存到相簿','工具']);
 for(const b of await page.locator('.lp-dock button').all()){const r=await b.boundingBox();assert.ok(r.y+r.height<=844&&r.y>844-120,'dock buttons sit in the thumb zone');assert.ok(r.height>=44,'dock buttons are comfortable to tap');}
 assert.equal(await page.locator('#prevPg').isVisible(),false,'paging is hidden while there is only one set');
 await page.screenshot({path:path.join(out,'2-placed.png')});
 results.push('photos placed on choose, four thumb actions PASS');

 // Tapping a photo offers the per-photo tools.
 await page.locator('.canvasBox .cell').first().click();
 for(const label of ['設為主圖（版面最大）','調整構圖（拖動顯示範圍）','確認這張構圖','在這組加保護區（留白放字）','自由編排（拖動、疊放）'])assert.equal(await page.locator('#photoSheet').getByText(label).first().isVisible(),true,label);
 await page.screenshot({path:path.join(out,'3-photo-actions.png')});
 await page.locator('#photoSheet').getByText('確認這張構圖',{exact:true}).click();
 assert.equal(await page.locator('dialog').getAttribute('data-view'),'確認構圖');await page.locator('dialog .lp-close').click();
 results.push('per-photo actions open from the photo PASS');

 // Tools sheet: opens from the dock, closes with Escape.
 await page.locator('.lp-dock-more').click();assert.equal(await page.locator('[data-action=preview]').isVisible(),true);
 await page.screenshot({path:path.join(out,'4-tools.png')});
 await page.keyboard.press('Escape');await page.waitForTimeout(300);assert.equal(await page.locator('[data-action=preview]').isVisible(),false);
 results.push('tools sheet opens from dock and closes with Escape PASS');

 // Saving: no review gate; if the share sheet refuses the late call, one more tap shares.
 await page.locator('.lp-dock [data-action=download]').click();
 await page.locator('#saveSheet').waitFor({state:'visible'});assert.equal(await page.locator('#saveTitle').textContent(),'1 張圖片已準備好');
 await page.screenshot({path:path.join(out,'5-save-again.png')});
 await page.locator('#saveShare').click();await page.waitForFunction(()=>window.__shares.length===2);
 assert.equal(await page.locator('#saveSheet').isVisible(),false);assert.equal(await page.locator('dialog').evaluate(el=>el.open),false,'no review prompt before saving');
 results.push('save goes to the share sheet, with a second tap when the browser needs one PASS');

 assert.deepEqual(errors,[]);await browser.close();
 fs.writeFileSync(path.join(out,'mobile-scrl-results.json'),JSON.stringify(results,null,2));console.log(results.join('\n'));
})().catch(e=>{console.error(e);process.exit(1)});
