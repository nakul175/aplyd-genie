import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {digest} from '../src/security.mjs';
import {MemberExports} from '../src/exports.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),other=id(2),a=id(10),b=id(11),foreign=id(12);
const token=name=>digest('synthetic-workspace-'+name);
const source=token('source'),next=token('next'),back=token('back'),device=token('other-device');
const expiry='2040-01-01T00:00:00.000Z',sealed='synthetic-encrypted-proof-placeholder-only';
let db;
const realPostgres=Boolean(process.env.GENIE_TEST_DATABASE_URL);
before(async()=>{
 if(realPostgres){
  const url=new URL(process.env.GENIE_TEST_DATABASE_URL);
  assert.ok(url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&/^\/genie_qual_[a-z0-9_]+$/.test(url.pathname),'Only an explicit loopback qualification database is allowed');
  const {default:pg}=await import('pg'),provision=new pg.Pool({connectionString:url.href,max:1});
  const name=url.pathname.slice(1)+'_workspaces';
  try{await provision.query(`CREATE DATABASE "${name}"`);}finally{await provision.end();}
  url.pathname='/'+name;const pool=new pg.Pool({connectionString:url.href,max:4,statement_timeout:5000});
  db={query:pool.query.bind(pool),exec:pool.query.bind(pool),close:pool.end.bind(pool),connect:pool.connect.bind(pool)};
 }else db=new PGlite();
 const folder=new URL('../migrations/',import.meta.url);
 for(const name of (await readdir(folder)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,folder),'utf8'));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec('TRUNCATE genie_users,genie_tenants RESTART IDENTITY CASCADE');
 for(const [tenant,name] of [[a,'Workspace A'],[b,'Workspace B'],[foreign,'Unrelated workspace']])await db.query('INSERT INTO genie_tenants(id,enabled,display_name) VALUES($1,true,$2)',[tenant,name]);
 for(const u of [actor,other])await db.query("INSERT INTO genie_users VALUES($1,'https://accounts.example.test',$2,true)",[u,'subject-'+u]);
 for(const [u,t,name] of [[actor,a,'Only in A'],[actor,b,'Only in B'],[other,foreign,'Only in C']]){
  await db.query("INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference,role) VALUES($1,$2,'active','synthetic-workspace-fixture','admin')",[u,t]);
  await db.query("INSERT INTO genie_workspace_people VALUES($1,$2,$3,'synthetic-workspace-fixture')",[t,u,name]);
 }
 for(const hash of [source,device])await db.query('INSERT INTO genie_sessions(token_hash,user_id,tenant_id,sealed_upstream,expires_at) VALUES($1,$2,$3,$4,$5)',[hash,actor,a,sealed,expiry]);
});
const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.value;
const switchTo=(from,to,tenant)=>value('SELECT genie_switch_workspace($1,$2,$3,$4) value',[from,to,tenant,sealed]);
const session=hash=>value('SELECT row_to_json(s) value FROM genie_sessions s WHERE token_hash=$1',[hash]);
const signOut=hash=>db.query('SELECT genie_sign_out_family($1)',[hash]);

test('switch rotates browser authority and preserves immutable tenant, actor and expiration bindings',async()=>{
 const before=await session(source);const result=await switchTo(source,next,b);
 assert.equal(result.changed,true);assert.equal(result.tenantId,b);assert.equal(result.name,'Workspace B');
 const original=await session(source),current=await session(next);
 assert.equal(original.browser_active,false);assert.equal(original.tenant_id,a);assert.equal(original.user_id,actor);
 assert.equal(current.browser_active,true);assert.equal(current.tenant_id,b);assert.equal(current.user_id,actor);
 assert.equal(current.family_id,before.family_id);assert.equal(current.expires_at,before.expires_at);
 assert.notEqual(current.family_id,(await session(device)).family_id);
 await assert.rejects(switchTo(source,back,a),{code:'40001'});
 assert.equal(await session(back),undefined);
});
test('foreign, disabled and absent destination memberships cannot rotate the active session',async()=>{
 await assert.rejects(switchTo(source,next,foreign),{code:'42501'});
 await db.query('UPDATE genie_tenants SET enabled=false WHERE id=$1',[b]);
 await assert.rejects(switchTo(source,next,b),{code:'42501'});
 await db.query('UPDATE genie_tenants SET enabled=true WHERE id=$1',[b]);
 await db.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1 AND tenant_id=$2",[actor,b]);
 await assert.rejects(switchTo(source,next,b),{code:'42501'});
 assert.equal((await session(source)).browser_active,true);assert.equal(await session(next),undefined);
});
test('switch cannot revive an expired or deactivated source context',async()=>{
 await db.query("UPDATE genie_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[source]);
 await assert.rejects(switchTo(source,next,b),{code:'40001'});
 await db.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1 AND tenant_id=$2",[actor,a]);
 await assert.rejects(switchTo(device,next,b),{code:'40001'});
 assert.equal(await session(next),undefined);
});
test('same-workspace choice is a no-op and invalid token rotation is rejected',async()=>{
 assert.deepEqual(await switchTo(source,next,a),{changed:false,tenantId:a,name:'Workspace A'});
 assert.equal(await session(next),undefined);
 await assert.rejects(switchTo(source,source,b),{code:'22023'});
 await assert.rejects(switchTo(source,'invalid',b),{code:'22023'});
});
test('queued job remains in its originating tenant and result can only be opened in that tenant',async()=>{
 const exports=new MemberExports(db);const job=await exports.enqueue(source);
 await switchTo(source,next,b);const lease=await exports.claim();
 assert.equal(lease.id,job.id);assert.equal(lease.tenantId,a);assert.equal(lease.userId,actor);assert.equal(lease.sessionHash,source);
 assert.equal((await exports.finish(lease.id,lease.lease,'ready')).status,'completed');
 await assert.rejects(exports.get(next,job.id),{status:404});
 await switchTo(next,back,a);
 const finished=await exports.get(back,job.id);
 assert.deepEqual(finished.result.items.map(x=>x.name),['Only in A']);
});
test('original workspace deactivation denies a pinned job without revoking the independent destination',async()=>{
 const exports=new MemberExports(db);const job=await exports.enqueue(source);await switchTo(source,next,b);
 const lease=await exports.claim();
 await db.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1 AND tenant_id=$2",[actor,a]);
 assert.equal((await exports.finish(job.id,lease.lease,'ready')).status,'denied');
 assert.equal(await value('SELECT result value FROM genie_member_exports WHERE id=$1',[job.id]),null);
 assert.equal((await session(next)).browser_active,true);
});
test('sign-out revokes all pinned contexts of only the current browser family',async()=>{
 const exports=new MemberExports(db),job=await exports.enqueue(source);await switchTo(source,next,b);
 const lease=await exports.claim();await signOut(source);
 assert.equal((await session(next)).browser_active,true);
 await signOut(next);
 assert.equal(await session(source),undefined);assert.equal(await session(next),undefined);
 assert.equal((await session(device)).browser_active,true);
 assert.equal((await exports.finish(job.id,lease.lease,'ready')).status,'denied');
});

const createConversation=(hash,title,content='Fixture opening message')=>value('SELECT genie_create_conversation($1,$2,$3) value',[hash,title,content]);
const conversation=(hash,thread,after=0)=>value('SELECT genie_get_conversation($1,$2,$3) value',[hash,thread,after]);
const append=(hash,thread,message)=>value('SELECT genie_append_conversation($1,$2,$3) value',[hash,thread,message]);
const search=(hash,query)=>value('SELECT genie_search_workspace($1,$2) value',[hash,query]);
const threads=hash=>value('SELECT genie_list_conversations($1) value',[hash]);

test('GENIE-5 AC2: conversations and structured resource search follow the current tenant, never a supplied resource ID',async()=>{
 const alpha=await createConversation(source,'Shared Alpha','Private message in A');
 await append(source,alpha.id,'Second message in A');
 assert.deepEqual((await conversation(source,alpha.id)).messages.map(m=>m.content),['Private message in A','Second message in A']);
 assert.deepEqual((await search(source,'Shared')).items.map(x=>x.label),['Shared Alpha']);
 await switchTo(source,next,b);
 await assert.rejects(threads(source),{code:'42501'});
 await assert.rejects(conversation(next,alpha.id),{code:'P0002'});
 await assert.rejects(append(next,alpha.id,'Cross-tenant overwrite'),{code:'P0002'});
 assert.deepEqual((await search(next,'Shared')).items,[]);
 const beta=await createConversation(next,'Shared Beta','Private message in B');
 assert.deepEqual((await search(next,'Shared')).items.map(x=>x.label),['Shared Beta']);
 assert.deepEqual((await search(next,'Only in')).items.map(x=>x.label),['Only in B']);
 assert.deepEqual((await search(next,'Private message')).items,[]);
 await switchTo(next,back,a);
 assert.deepEqual((await threads(back)).items.map(x=>x.title),['Shared Alpha']);
 assert.deepEqual((await search(back,'Only in')).items.map(x=>x.label),['Only in A']);
 await assert.rejects(conversation(back,beta.id),{code:'P0002'});
});
test('another user in the same tenant cannot read, append or find a private conversation',async()=>{
 const item=await createConversation(source,'Private shared word');const outsider=token('other-owner');
 await db.query("INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference,role) VALUES($1,$2,'active','synthetic-review','admin')",[other,a]);
 await db.query('INSERT INTO genie_sessions(token_hash,user_id,tenant_id,sealed_upstream,expires_at) VALUES($1,$2,$3,$4,$5)',[outsider,other,a,sealed,expiry]);
 assert.deepEqual((await threads(outsider)).items,[]);assert.deepEqual((await search(outsider,'shared word')).items,[]);
 await assert.rejects(conversation(outsider,item.id),{code:'P0002'});
 await assert.rejects(append(outsider,item.id,'Unauthorized'),{code:'P0002'});
});
test('workspace search grants resource visibility independently from private conversation access',async()=>{
 await createConversation(source,'Only in conversation');
 await value("SELECT genie_save_role($1,NULL,'Only in role','[]'::jsonb,NULL) value",[source]);
 assert.deepEqual((await search(source,'Only in')).items.map(x=>x.kind),['conversation','member','role']);
 await db.query("UPDATE genie_memberships SET role='member' WHERE user_id=$1 AND tenant_id=$2",[actor,a]);
 assert.deepEqual((await search(source,'Only in')).items.map(x=>x.kind),['conversation']);
 assert.deepEqual((await search(source,'%%')).items,[]);
 await assert.rejects(search(source,'x'),{code:'22023'});
 await db.query('UPDATE genie_tenants SET enabled=false WHERE id=$1',[a]);
 await assert.rejects(search(source,'Only in'),{code:'42501'});
});
test('conversation messages are bounded and page without duplicates or cross-tenant identifiers',async()=>{
 const item=await createConversation(source,'Paged conversation','First');
 await db.query("INSERT INTO genie_conversation_messages(tenant_id,conversation_id,ordinal,content) SELECT $1,$2,n,'Fixture '||n FROM generate_series(2,100) n",[a,item.id]);
 await db.query('UPDATE genie_conversations SET message_count=100 WHERE id=$1',[item.id]);
 const page=await conversation(source,item.id);assert.equal(page.messages.length,50);assert.equal(page.nextCursor,50);
 const tail=await conversation(source,item.id,50);assert.equal(tail.messages.length,50);assert.equal(tail.nextCursor,null);assert.equal(tail.messages[0].ordinal,51);
 await assert.rejects(append(source,item.id,'Over quota'),{code:'53300'});
 await assert.rejects(createConversation(source,'Invalid',' '.repeat(3)),{code:'22023'});
});
test('actual PostgreSQL allows only one concurrent rotation of a browser context',{skip:!realPostgres},async()=>{
 const outcomes=await Promise.allSettled([switchTo(source,next,b),switchTo(source,back,b)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'40001');
 assert.equal(await value('SELECT count(*)::int value FROM genie_sessions WHERE family_id=(SELECT family_id FROM genie_sessions WHERE token_hash=$1) AND browser_active',[source]),1);
});
test('actual PostgreSQL runtime entry points never grant direct conversation or internal context access',{skip:!realPostgres},async()=>{
 await db.exec("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='genie_workspace_qualification') THEN CREATE ROLE genie_workspace_qualification NOLOGIN; END IF; END $$;");
 const grants=(await readFile(new URL('../ops/staging/genie-5/grants.sql',import.meta.url),'utf8')).replaceAll('genie_runtime','genie_workspace_qualification');
 await db.exec(grants);
 const client=await db.connect();
 try{
  await client.query('SET ROLE genie_workspace_qualification');
  for(const sql of ['SELECT * FROM genie_conversations','SELECT * FROM genie_conversation_messages','SELECT genie_workspace_actor(NULL,false)','UPDATE genie_sessions SET browser_active=false WHERE false'])await assert.rejects(client.query(sql),{code:'42501'});
  const created=(await client.query("SELECT genie_create_conversation($1,'Qualified conversation','Fixture') AS value",[source])).rows[0].value;
  await client.query("SELECT genie_append_conversation($1,$2,'Follow-up')",[source,created.id]);
  const listed=(await client.query('SELECT genie_list_conversations($1,NULL) value',[source])).rows[0].value;assert.equal(listed.items[0].id,created.id);
  const read=(await client.query('SELECT genie_get_conversation($1,$2,0) AS value',[source,created.id])).rows[0].value;assert.deepEqual(read.messages.map(x=>x.content),['Fixture','Follow-up']);
  const found=(await client.query("SELECT genie_search_workspace($1,'Qualified') value",[source])).rows[0].value;assert.equal(found.items[0].id,created.id);
  await client.query('SELECT genie_switch_workspace($1,$2,$3,$4)',[source,next,b,sealed]);
  await assert.rejects(client.query('SELECT genie_get_conversation($1,$2,0)',[next,created.id]),{code:'P0002'});
  await client.query('SELECT genie_sign_out_family($1)',[next]);
 }finally{await client.query('RESET ROLE');client.release();}
});
