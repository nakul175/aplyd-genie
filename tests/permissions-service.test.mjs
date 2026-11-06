import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Permissions,roleGrants} from '../src/permissions.mjs';
const session='a'.repeat(64),role='00000000-0000-4000-8000-000000000001',target='00000000-0000-4000-8000-000000000002';
const read={resource:'workspace.members',action:'read'};
test('untrusted grant shapes and ambiguous duplicates never reach database mutation',()=>{
 let calls=0;const service=new Permissions({query(){calls++;throw Error('unexpected write');}});
 for(const grants of [[read,read],[{...read,tenantId:'foreign'}],[{resource:'*',action:'*'}],[null],Array.from({length:33},()=>read)])
  assert.throws(()=>service.save(session,{name:'Reader',grants}),e=>e.status===400);
 assert.equal(calls,0);assert.deepEqual(roleGrants([]),[]);
});
test('browser-supplied principal fields cannot replace the server-derived authorization session',async()=>{
 let args;const service=new Permissions({async query(_sql,input){args=input;return{rows:[{result:{changed:true}}]};}});
 await service.save(session,{name:'Reader',grants:[read],session:'attacker',tenantId:'other',actorId:'other'});
 assert.equal(args[0],session);assert.equal(args.includes('attacker'),false);assert.equal(args.includes('other'),false);
});
test('effective capabilities are fetched again after authority changes',async()=>{
 let grants=[read];let calls=0;const service=new Permissions({async query(){calls++;return{rows:[{result:grants}]};}});
 assert.deepEqual(await service.capabilities(session),[read]);grants=[];assert.deepEqual(await service.capabilities(session),[]);assert.equal(calls,2);
});
test('role assignment validates immutable IDs, boolean intent and bounded optimistic versions',()=>{
 const service=new Permissions({query(){throw Error('unexpected write');}});
 for(const change of [{target,roleId:role,assigned:'true',version:'1'},{target:'foreign',roleId:role,assigned:true,version:'1'},{target,roleId:role,assigned:true,version:'9223372036854775808'},{target,roleId:role,assigned:true,version:'0'}])
  assert.throws(()=>service.assign(session,change),e=>e.status===400);
});
test('role updates require an explicit valid version before a database write',()=>{
 const service=new Permissions({query(){throw Error('unexpected write');}});
 assert.throws(()=>service.save(session,{roleId:role,name:'Reader',grants:[read]}),e=>e.status===400);
 assert.throws(()=>service.save(session,{name:' Reader ',grants:[read]}),e=>e.status===400);
 assert.throws(()=>service.save(session,{name:'Reader\n',grants:[read]}),e=>e.status===400);
});
test('missing or malformed server sessions are rejected before policy lookup',async()=>{
 const service=new Permissions({query(){throw Error('unexpected lookup');}});
 await assert.rejects(service.capabilities('browser-cookie-value'),e=>e.status===401);
});
test('database authorization and conflict failures become bounded public service errors',async()=>{
 for(const [code,status,message] of [['42501',403,'permission_required'],['40001',409,'role_or_membership_changed_refresh_required'],['P0002',404,'role_or_member_unavailable']]){
  const service=new Permissions({async query(){throw Object.assign(new Error('private database detail'),{code});}});
  await assert.rejects(service.capabilities(session),e=>e.status===status&&e.message===message);
 }
});
