const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.LAYOUT_TEST_URL||'http://127.0.0.1:8765/';
const out=process.argv[2]||path.join(__dirname,'../evidence/operability');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();const results=[];
for(const [mobile,width,height] of [[false,1366,768],[false,1440,900],[true,390,844]]){
 const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+(mobile?'m/':''));await page.locator('.lp-bar').waitFor();
 assert.equal(await page.locator('.lp-flow-nav').count(),0,'the suggested steps are instructions, not a navigation mode');
 for(const label of ['照片','編輯','輸出與專案','檢視與復原'])assert.equal(await page.getByRole('group',{name:label,exact:true}).count(),1);
 for(const action of ['add','make','pool','shuffle','edit','review','preview','formats','download','save','fit','undo','redo'])assert.equal(await page.locator('[data-action='+action+']').isVisible(),true);
 if(mobile){await page.locator('[data-p=igc]').click();await page.locator('#carouselRatio').selectOption('1080');const bounds=await page.locator('#carouselRatio').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'carousel ratio is directly visible without a hidden horizontal control');assert.equal(await page.locator('#settingsBtn').isVisible(),true);}else{for(const id of ['preset','margin','gutter','scale','nocrop','bgMode','dpi','qual'])assert.equal(await page.locator('#'+id).isVisible(),true);await page.locator('#preset').selectOption('igc');await page.locator('#carouselRatio').selectOption('1080');}
 assert.equal(await page.evaluate(()=>igMeta().ph),1080);assert.equal(await page.locator('dialog').evaluate(el=>el.open),false);
 assert.equal(await page.locator('[data-action=review]').isEnabled(),false);assert.equal(await page.locator('[data-action=formats]').isEnabled(),false);
 const source=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=1200;const x=c.getContext('2d');x.fillStyle='#447a91';x.fillRect(0,0,900,1200);x.fillStyle='#b4d2ca';x.fillRect(80,200,740,620);x.fillStyle='#203746';x.font='60px sans-serif';x.fillText('UI TEST',300,550);return c.toDataURL('image/jpeg').split(',')[1];});
 await page.locator('#file').setInputFiles(Array.from({length:6},(_,i)=>({name:'ui-'+i+'.jpg',mimeType:'image/jpeg',buffer:Buffer.from(source,'base64')})));
 await page.waitForFunction(()=>photos.length===6);if(!mobile)await page.waitForFunction(()=>document.querySelector('#overlay').style.display==='none');
 await page.locator('#selAll').click();await page.locator('[data-action=make]').click();assert.equal(await page.evaluate(()=>pages.flatMap(allIds).length),6);
 for(const action of ['review','formats','preview','download'])assert.equal(await page.locator('[data-action='+action+']').isEnabled(),true);
 const before=await page.evaluate(()=>JSON.stringify(LayoutPlus.snapshot()));
 await page.getByRole('button',{name:'ⓘ 操作說明',exact:true}).click();assert.equal(await page.locator('dialog .lp-guide-list li').count(),5);await page.locator('dialog .lp-close').click();
 assert.equal(await page.evaluate(()=>JSON.stringify(LayoutPlus.snapshot())),before,'help does not alter the project');
 await page.locator('[data-action=review]').click();assert.equal(await page.locator('dialog').getAttribute('data-view'),'確認構圖');await page.locator('dialog .lp-close').click();
 await page.locator('[data-action=formats]').click();assert.equal(await page.locator('dialog input[type=checkbox]').count(),4);await page.locator('dialog .lp-close').click();
 if(!mobile){await page.locator('#preset').selectOption('igst');await page.locator('[data-action=fit]').click();const bounds=await page.locator('.canvasBox').first().boundingBox();assert.ok(bounds.height>=300,'portrait remains readable with permanent settings');await page.screenshot({path:path.join(out,`desktop-${width}-portrait.png`)});await page.locator('#preset').selectOption('igc');await page.locator('#carouselRatio').selectOption('1350');await page.locator('#igPanels').fill('10');await page.locator('#igPanels').dispatchEvent('change');}
 await page.locator('[data-action=pool]').click();assert.equal(await page.locator('[data-action=pool]').getAttribute('aria-pressed'),'false');await page.locator('[data-action=fit]').click();
 await page.screenshot({path:path.join(out,`${mobile?'mobile': 'desktop-'+width}-carousel.png`)});
 assert.deepEqual(errors,[]);results.push(`${mobile?'mobile emulation': 'desktop'} ${width}x${height}: native settings, tool groups, direct review/formats, optional help, readable canvas PASS`);await page.close();
}
await browser.close();fs.writeFileSync(path.join(out,'operability-results.json'),JSON.stringify(results,null,2));console.log(results.join('\n'));})().catch(e=>{console.error(e);process.exit(1)});
