import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/session-watch.js',import.meta.url),'utf8');
function fixture(fetch){
 const events={},main={children:['protected data'],replaceChildren(...children){this.children=children}};
 let interval,cleared=false,reloads=0;
 const document={visibilityState:'visible',querySelector:()=>main,createElement:()=>({}),addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(source,{document,window:{addEventListener:(name,fn)=>events[name]=fn},fetch,
  AbortSignal,location:{reload:()=>reloads++},setInterval:fn=>(interval=fn,1),clearInterval:()=>cleared=true});
 return {main,events,document,poll:()=>interval(),get cleared(){return cleared},get reloads(){return reloads}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const status of [401,403,409])test(`current authority ${status} removes rendered protected data and forms`,async()=>{
 const f=fixture(async()=>({status,ok:false}));await tick();
 assert.equal(f.main.children[0].textContent,'Your workspace access changed');
 assert.equal(f.main.children[1].href,'/auth/sign-in');assert.equal(f.cleared,true);
});
test('unverifiable authority clears stale content; recovery reloads fresh server authority',async()=>{
 let online=false;const f=fixture(async()=>({status:online?200:503,ok:online}));await tick();
 assert.equal(f.main.children[0].textContent,'Workspace access could not be verified');
 online=true;await f.poll();assert.equal(f.reloads,1);
});
test('one bounded request at a time; hidden pages skip polling and pagehide stops it',async()=>{
 let calls=0,release;const f=fixture(async(_url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert(options.signal);return new Promise(r=>release=r)});
 await f.poll();assert.equal(calls,1);release({ok:true,status:200});await tick();
 f.document.visibilityState='hidden';await f.poll();assert.equal(calls,1);
 f.document.visibilityState='visible';f.events.pagehide();await f.poll();assert.equal(calls,1);assert(f.cleared);
});
