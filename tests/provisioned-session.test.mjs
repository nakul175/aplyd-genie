import {test} from 'node:test';import assert from 'node:assert/strict';
import {createAccounts} from '../src/accounts.mjs';import {createSessionAuthenticator} from '../src/authentication.mjs';import {seal,HttpError} from '../src/security.mjs';
const id='10000000-0000-4000-8000-000000000001',tenant='10000000-0000-4000-8000-000000000002';
const config={issuer:'https://accounts.example.test',clientId:'aplyd-genie-staging',clientSecret:'synthetic-test-only-secret',key:Buffer.alloc(32,1)};
const proof={requestId:id,tenantId:tenant};
test('provisioned proof is exact and never accepted from unknown/mismatched response',async()=>{
 const body={active:true,sub:'known',native_user_id:id,tenant_id:tenant,request_id:id};
 for(const response of [body,{...body,sub:'other'},{...body,tenant_id:id},{...body,active:false},{...body,request_id:tenant},{}]){
  const a=createAccounts(config,{fetch:async()=>new Response(JSON.stringify(response))});
  if(response===body)await a.requireProvision('known','uid',id,proof,tenant);else await assert.rejects(a.requireProvision('known','uid',id,proof,tenant),e=>[401,503].includes(e.status));
 }
});
test('marked native session cannot bypass absent proof service; actual revoke deletes old session',async()=>{
 const session={user_id:id,tenant_id:tenant,subject:'known',issuer:config.issuer,sealed_upstream:seal(config.key,`session:${id}:${tenant}`,{uid:'uid'})};let deleted=0;
 const store={getSession:async()=>deleted?null:session,provisioning:async()=>proof,deleteSession:async()=>{deleted++}};
 const accounts={requireSession:async()=>{},requireProvision:async()=>{throw new HttpError(401,'authentication_required')}};
 const authenticate=createSessionAuthenticator({config,store,accounts});await assert.rejects(authenticate('a'.repeat(64)),{status:401});assert.equal(deleted,1);
 accounts.requireProvision=async()=>{};await assert.rejects(authenticate('a'.repeat(64)),{status:401});
});
test('legacy identity keeps existing session path while authority outage does not grant a marked one',async()=>{
 const session={user_id:id,tenant_id:tenant,subject:'known',issuer:config.issuer,sealed_upstream:seal(config.key,`session:${id}:${tenant}`,{uid:'uid'})};
 let p=null,calls=0;const store={getSession:async()=>session,provisioning:async()=>p,deleteSession:async()=>{throw Error('outage must not destroy session')}};
 const accounts={requireSession:async()=>{},requireProvision:async()=>{calls++;throw new HttpError(503,'identity_unavailable')}};
 const auth=createSessionAuthenticator({config,store,accounts});assert.equal((await auth('a'.repeat(64))).userId,id);assert.equal(calls,0);p=proof;await assert.rejects(auth('a'.repeat(64)),{status:503});assert.equal(calls,1);
});

test('additional-workspace proof uses separate endpoint and checks request, subject and exact target workspace',async()=>{
 const extra={requestId:'10000000-0000-4000-8000-000000000003',tenantId:tenant,kind:'workspace-enrollment'};
 let calls=0;const authority=createAccounts(config,{fetch:async(url,options)=>{calls++;assert.equal(url.pathname,'/internal/genie/enrollment-access');const i=JSON.parse(options.body);assert.equal(i.request_id,extra.requestId);return new Response(JSON.stringify({active:true,sub:i.sub,native_user_id:i.native_user_id,tenant_id:i.tenant_id,request_id:i.request_id}))}});
 await authority.requireProvision('known','uid',id,extra,tenant);assert.equal(calls,1);
 await assert.rejects(authority.requireProvision('known','uid',id,extra,id),{status:401});assert.equal(calls,1);
});
