const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=process.env.LAYOUT_TEST_ROOT || path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'editor-plus.js'),'utf8');
const storage=source.slice(source.indexOf('  function openDB(){'),source.indexOf('  function scheduleSave(){'));
const save=source.slice(source.indexOf('  function saveDraft(){'),source.indexOf('  async function importAssets('));
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function setup(){
  let now=0,next=0;
  const timers=new Map(),requests=[],connections=[],transactions=[],statuses=[],puts=[];
  let autoOpen=false,complete=false,throws=false;
  const context={
    mode:'desktop',busy:false,restoring:false,saveTimer:undefined,photos:[{id:1,file:{name:'synthetic.jpg'}}],draftPending:true,
    saveChain:Promise.resolve(),snapshot:()=>({ids:[1]}),fingerprint:JSON.stringify,status:s=>statuses.push(s),
    setTimeout(fn,ms){const id=++next;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),
    indexedDB:{open(){
      const tx={aborts:0,abort(){this.aborts++;}};
      const db={closed:0,close(){this.closed++;},createObjectStore(){},transaction(){
        if(throws)throw Error('transaction setup failed');
        const tx={aborts:0,commits:0,abort(){this.aborts++;this.onabort?.();},commit(){this.commits++;},objectStore(){return {
          put(value){puts.push(value);if(complete)queueMicrotask(()=>tx.oncomplete?.());return {result:1};},
          get(){if(complete)queueMicrotask(()=>tx.oncomplete?.());return {result:'draft'};}
        };}};
        transactions.push(tx);return tx;
      }};
      const request={result:db,transaction:tx};requests.push(request);connections.push(db);
      if(autoOpen)queueMicrotask(()=>request.onsuccess?.());
      return request;
    }},
  };
  const ctx=vm.createContext(context);vm.runInContext(storage+'\n'+save,ctx);
  return {ctx,requests,connections,transactions,statuses,timers,puts,
    configure(v){if('autoOpen'in v)autoOpen=v.autoOpen;if('complete'in v)complete=v.complete;if('throws'in v)throws=v.throws;},
    async advance(ms){now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await flush();}
  };
}
(async()=>{
  // A blocked upgrade must reject promptly and close any eventual connection.
  {
    const e=setup();let outcome='pending';e.ctx.openDB().then(()=>outcome='resolved',()=>outcome='rejected');
    e.requests[0].onblocked?.();await flush();assert.equal(outcome,'rejected','blocked open must settle');
    e.requests[0].onupgradeneeded?.();assert.equal(e.requests[0].transaction.aborts,1,'late upgrade must abort');
    e.requests[0].onsuccess();assert.equal(e.connections[0].closed,1,'late open must close');assert.equal(e.timers.size,0);
    console.log('blocked open: rejected; late upgrade aborted and late connection closed PASS');
  }
  {
    const e=setup();let outcome='pending';e.ctx.openDB().then(()=>outcome='resolved',()=>outcome='rejected');
    await e.advance(14999);assert.equal(outcome,'pending');await e.advance(1);assert.equal(outcome,'rejected','silent open must time out after 15s');
    e.requests[0].onsuccess();assert.equal(e.connections[0].closed,1);
    console.log('silent open: bounded at 15000ms; late connection closed PASS');
  }
  {
    const e=setup();e.configure({autoOpen:true});let outcome='pending';e.ctx.dbOperation('put',{}).then(()=>outcome='resolved',()=>outcome='rejected');await flush();
    await e.advance(29999);assert.equal(outcome,'pending');await e.advance(1);assert.equal(outcome,'rejected','silent transaction must time out after 30s');
    assert.equal(e.transactions[0].aborts,1);assert.equal(e.connections[0].closed,1);assert.equal(e.timers.size,0);
    console.log('silent write: bounded at 30000ms; transaction aborted and connection closed PASS');
  }
  for(const event of ['oncomplete','onerror','onabort','throw']){
    const e=setup();e.configure({autoOpen:true,throws:event==='throw'});
    let outcome='pending';e.ctx.dbOperation('get').then(()=>outcome='resolved',()=>outcome='rejected');await flush();
    if(event!=='throw')e.transactions[0][event]();await flush();
    assert.equal(outcome,event==='oncomplete'?'resolved':'rejected');assert.equal(e.connections[0].closed,1);assert.equal(e.timers.size,0);
    if(event==='oncomplete'){e.connections[0].onversionchange?.();assert.equal(e.connections[0].closed,2);}
  }
  console.log('transaction completion/error/abort/setup failure: timers cleared and connections closed PASS');
  {
    const e=setup();e.configure({autoOpen:true});const first=e.ctx.saveDraft();await flush();
    assert.equal(e.statuses.at(-1),'儲存草稿中…');await e.advance(30000);await first;
    assert.equal(e.statuses.at(-1),'草稿未存成功，請下載專案備份');assert.equal(e.ctx.draftPending,true);
    e.configure({complete:true});await e.ctx.saveDraft();assert.equal(e.statuses.at(-1),'草稿已存於此裝置');assert.equal(e.ctx.draftPending,false);
    assert.equal(e.requests.length,2);assert.equal(e.timers.size,0);
    console.log('save chain: timeout shows backup guidance; subsequent save succeeds PASS');
  }
  {
    // Leaving the page cannot wait for openDB(): the final write starts synchronously on a kept connection,
    // and a save still waiting to open must not write older state over it.
    const e=setup();e.configure({autoOpen:true});e.ctx.keepLiveDB();await flush();e.configure({autoOpen:false});
    let ids=[1];e.ctx.snapshot=()=>({ids:[...ids]});
    const queued=e.ctx.saveDraft();await flush();assert.equal(e.transactions.length,0);
    ids=[1,2];e.ctx.flushDraft();
    assert.equal(e.transactions.length,1,'unload flush must write without awaiting an open');assert.equal(e.transactions[0].commits,1);
    assert.deepEqual(e.puts[0].state.ids,[1,2]);
    e.ctx.flushDraft();assert.equal(e.transactions.length,1,'visibilitychange then pagehide must not rewrite the same state');
    e.requests.at(-1).onsuccess();await flush();assert.deepEqual(e.puts[1].state.ids,[1,2],'queued save must snapshot when it writes');
    e.transactions[0].oncomplete();e.transactions[1].oncomplete();await queued;
    assert.equal(e.ctx.draftPending,false);assert.equal(e.statuses.at(-1),'草稿已存於此裝置');assert.equal(e.timers.size,0);
    console.log('unload flush: synchronous committed write; queued save never older PASS');
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
