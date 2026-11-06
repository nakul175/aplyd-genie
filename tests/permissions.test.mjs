import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {digest} from '../src/security.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),reader=id(2),steward=id(3),plain=id(4),foreign=id(5),tenant=id(10),other=id(11);
const session=u=>digest('synthetic-policy-'+u);
const grant=(resource,action)=>({resource,action});
let db;
const realPostgres=Boolean(process.env.GENIE_TEST_DATABASE_URL);
before(async()=>{
 if(realPostgres){
  const url=new URL(process.env.GENIE_TEST_DATABASE_URL);
  assert.ok(url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&/^\/genie_qual_[a-z0-9_]+$/.test(url.pathname),'Only an explicit loopback qualification database is allowed');
  const {default:pg}=await import('pg');const provision=new pg.Pool({connectionString:url.href,max:1});
  const name=url.pathname.slice(1)+'_permissions';
  try{await provision.query(`CREATE DATABASE "${name}"`);}finally{await provision.end();}
  url.pathname='/'+name;const pool=new pg.Pool({connectionString:url.href,max:4,statement_timeout:5000});
  db={query:pool.query.bind(pool),exec:pool.query.bind(pool),close:pool.end.bind(pool),connect:pool.connect.bind(pool)};
  assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0);
 }else{const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();}
 for(const name of ['001_identity_sessions.sql','002_shared_rate_limits.sql','003_workspace_memberships.sql','004_audit_page_cursor.sql','005_resource_permissions.sql'])await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
});
after(async()=>{await db?.close()});
beforeEach(async()=>{
 await db.exec('TRUNCATE genie_users,genie_tenants RESTART IDENTITY CASCADE');
 for(const u of [admin,reader,steward,plain,foreign])await db.query('INSERT INTO genie_users VALUES($1,$2,$3,true)',[u,'https://accounts.example.test','subject-'+u]);
 for(const t of [tenant,other])await db.query('INSERT INTO genie_tenants VALUES($1,true)',[t]);
 for(const [u,t,r] of [[admin,tenant,'admin'],[reader,tenant,'member'],[steward,tenant,'member'],[plain,tenant,'member'],[foreign,other,'admin']]){
  await db.query("INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference,role) VALUES($1,$2,'active','synthetic-review',$3)",[u,t,r]);
  await db.query("INSERT INTO genie_sessions(token_hash,user_id,tenant_id,sealed_upstream,expires_at) VALUES($1,$2,$3,'fixture-unused',now()+interval '1 hour')",[session(u),u,t]);
 }
});
const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.value;
const capabilities=u=>value('SELECT genie_current_capabilities($1) value',[session(u)]);
const version=u=>value('SELECT version::text value FROM genie_memberships WHERE user_id=$1',[u]);
const save=(who,name,grants,role=null,v=null)=>value('SELECT genie_save_role($1,$2,$3,$4::jsonb,$5) value',[session(who),role,name,JSON.stringify(grants),v]);
const assign=async(who,target,role,on=true,v)=>value('SELECT genie_assign_role($1,$2,$3,$4,$5) value',[session(who),target,role,on,v??await version(target)]);

test('GENIE-4 AC1 database boundary: catalogue grants separate read from management',async()=>{
 assert.equal((await capabilities(admin)).length,10);assert.deepEqual(await capabilities(reader),[]);
 const role=await save(admin,'Membership reader',[grant('workspace.members','read')]);
 await assign(admin,reader,role.id);
 assert.deepEqual(await capabilities(reader),[grant('workspace.members','read')]);
 await value('SELECT count(*) value FROM genie_permission_actor($1,$2,$3)',[session(reader),'workspace.members','read']);
 await assert.rejects(value('SELECT count(*) value FROM genie_permission_actor($1,$2,$3)',[session(reader),'workspace.members','manage']),{code:'42501'});
});
test('roles and assignments cannot cross tenant boundaries',async()=>{
 const role=await save(admin,'Reader',[grant('workspace.members','read')]);
 await assert.rejects(save(foreign,'Other',[],role.id,'1'),{code:'P0002'});
 await assert.rejects(assign(foreign,foreign,role.id),{code:'P0002'});
 await assert.rejects(assign(admin,foreign,role.id),{code:'P0002'});
 assert.deepEqual(await capabilities(plain),[]);
});
test('GENIE-4 AC3 database boundary: a delegated role manager cannot create or assign stronger authority',async()=>{
 const limits=[grant('workspace.roles','manage'),grant('workspace.roles','assign'),grant('workspace.members','read')];
 const manager=await save(admin,'Scoped steward',limits);await assign(admin,steward,manager.id);
 const narrow=await save(steward,'Delegated reader',[grant('workspace.members','read')]);await assign(steward,reader,narrow.id);
 await assert.rejects(save(steward,'Escalation',[grant('workspace.members','manage')]),{code:'42501'});
 const strong=await save(admin,'Membership manager',[grant('workspace.members','manage')]);
 await assert.rejects(assign(steward,plain,strong.id),{code:'42501'});
 await assert.rejects(save(steward,'Stripped manager',[],strong.id,'1'),{code:'42501'});
 assert.deepEqual(await capabilities(plain),[]);
});
test('ordinary members cannot grant roles, assign roles or modify built-in administrator authority',async()=>{
 const role=await save(admin,'Reader',[grant('workspace.members','read')]);
 await assert.rejects(save(reader,'Forbidden',[]),{code:'42501'});
 await assert.rejects(assign(reader,reader,role.id),{code:'42501'});
 await assert.rejects(assign(admin,admin,role.id),{code:'42501'});
});
test('GENIE-4 AC2 database boundary: definition edits and unassignment take effect on the existing session',async()=>{
 const role=await save(admin,'Reader',[grant('workspace.members','read')]);await assign(admin,reader,role.id);
 assert.equal((await capabilities(reader)).length,1);
 await save(admin,'Reader',[],role.id,'1');assert.deepEqual(await capabilities(reader),[]);
 await save(admin,'Reader',[grant('workspace.members','read')],role.id,'2');assert.equal((await capabilities(reader)).length,1);
 await assign(admin,reader,role.id,false);assert.deepEqual(await capabilities(reader),[]);
 assert.equal(await value('SELECT count(*)::int value FROM genie_sessions WHERE token_hash=$1',[session(reader)]),1);
});
test('expired sessions and disabled membership, identity or tenant do not retain policy authority',async()=>{
 await db.query('UPDATE genie_users SET enabled=false WHERE id=$1',[admin]);await assert.rejects(capabilities(admin),{code:'42501'});
 await db.query('UPDATE genie_users SET enabled=true WHERE id=$1',[admin]);await db.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1",[admin]);await assert.rejects(save(admin,'Denied',[]),{code:'42501'});
 await db.query("UPDATE genie_memberships SET status='active' WHERE user_id=$1",[admin]);await db.query('UPDATE genie_tenants SET enabled=false WHERE id=$1',[tenant]);await assert.rejects(capabilities(admin),{code:'42501'});
 await db.query('UPDATE genie_tenants SET enabled=true WHERE id=$1',[tenant]);await db.query("UPDATE genie_sessions SET expires_at=now()-interval '1 second'");await assert.rejects(capabilities(admin),{code:'42501'});
});
test('unknown, wildcard, duplicate and malformed grants are rejected without writes',async()=>{
 for(const bad of [[grant('*','*')],[grant('workspace.members','read'),grant('workspace.members','read')],[{resource:'workspace.members',action:'read',extra:true}],[{resource:1,action:'read'}],null]){
  await assert.rejects(save(admin,'Invalid',bad),{code:'22023'});
 }
 assert.equal(await value('SELECT count(*)::int value FROM genie_roles'),0);
});
test('stale role and assignment versions reject lost updates; no-op retries add no audit',async()=>{
 const role=await save(admin,'Reader',[grant('workspace.members','read')]);
 assert.equal((await save(admin,'Reader',[grant('workspace.members','read')],role.id,'1')).changed,false);
 await save(admin,'Renamed reader',[grant('workspace.members','read')],role.id,'1');
 await assert.rejects(save(admin,'Stale',[],role.id,'1'),{code:'40001'});
 await assign(admin,reader,role.id);
 assert.equal((await assign(admin,reader,role.id)).changed,false);
 await assert.rejects(assign(admin,reader,role.id,false,'1'),{code:'40001'});
 assert.equal(await value('SELECT count(*)::int value FROM genie_permission_audit'),3);
});
test('policy audit failure rolls back definition edits and assignment state atomically',async()=>{
 const role=await save(admin,'Reader',[grant('workspace.members','read')]);const before=await version(reader);
 await db.exec("CREATE FUNCTION genie_policy_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER genie_policy_audit_guard BEFORE INSERT ON genie_permission_audit FOR EACH ROW EXECUTE FUNCTION genie_policy_audit_failure()");
 try{
  await assert.rejects(save(admin,'Broken',[],role.id,'1'),{code:'P0001'});
  await assert.rejects(assign(admin,reader,role.id),{code:'P0001'});
  assert.equal(await version(reader),before);assert.deepEqual(await capabilities(reader),[]);
  assert.equal(await value('SELECT name value FROM genie_roles WHERE id=$1',[role.id]),'Reader');
  assert.equal(await value('SELECT count(*)::int value FROM genie_role_permissions WHERE role_id=$1',[role.id]),1);
 }finally{await db.exec('DROP TRIGGER genie_policy_audit_guard ON genie_permission_audit; DROP FUNCTION genie_policy_audit_failure()');}
});
