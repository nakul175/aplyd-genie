import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MemberExports,runMemberExport} from '../src/exports.mjs';
import {Permissions} from '../src/permissions.mjs';
import {HttpError} from '../src/security.mjs';
import {digest} from '../src/security.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),reader=id(2),steward=id(3),plain=id(4),foreign=id(5),tenant=id(10),other=id(11),invitee=id(6);
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
 for(const name of ['001_identity_sessions.sql','002_shared_rate_limits.sql','003_workspace_memberships.sql','004_audit_page_cursor.sql','005_resource_permissions.sql','006_permission_aware_memberships.sql','007_authorized_exports.sql'])await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
});
after(async()=>{await db?.close()});
beforeEach(async()=>{
 await db.exec('TRUNCATE genie_users,genie_tenants RESTART IDENTITY CASCADE');
 for(const u of [admin,reader,steward,plain,foreign,invitee])await db.query('INSERT INTO genie_users VALUES($1,$2,$3,true)',[u,'https://accounts.example.test','subject-'+u]);
 for(const t of [tenant,other])await db.query('INSERT INTO genie_tenants VALUES($1,true)',[t]);
 for(const u of [admin,reader,steward,plain,invitee])await db.query("INSERT INTO genie_workspace_people VALUES($1,$2,$3,'synthetic-review')",[tenant,u,'Fixture '+u]);
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

test('permission-aware member pages allow readers without granting membership mutations',async()=>{
 const role=await save(admin,'Reader',[grant('workspace.members','read')]);await assign(admin,reader,role.id);
 const page=await value("SELECT genie_membership_page($1,'members',NULL,'') value",[session(reader)]);
 assert.equal(page.items.length,4);
 await assert.rejects(value("SELECT genie_membership_page($1,'people',NULL,'') value",[session(reader)]),{code:'42501'});
 await assert.rejects(value("SELECT genie_change_member($1,$2,'disabled','member',1) value",[session(reader),plain]),{code:'42501'});
});
test('delegated membership managers can change ordinary status but cannot alter built-in administrators',async()=>{
 const role=await save(admin,'Member manager',[grant('workspace.members','read'),grant('workspace.members','manage')]);await assign(admin,steward,role.id);
 assert.equal((await value("SELECT genie_change_member($1,$2,'disabled','member',1) value",[session(steward),plain])).changed,true);
 await assert.rejects(value("SELECT genie_change_member($1,$2,'disabled','admin',1) value",[session(steward),admin]),{code:'42501'});
 await assert.rejects(value("SELECT genie_change_member($1,$2,'active','admin',1) value",[session(steward),reader]),{code:'42501'});
});
test('delegated invitations cannot grant administrator role and lose validity when creator authority is revoked',async()=>{
 const role=await save(admin,'Invitation creator',[grant('workspace.invitations','create')]);await assign(admin,steward,role.id);
 await assert.rejects(value("SELECT genie_create_invite($1,$2,'admin',$3) value",[session(steward),invitee,digest('synthetic-admin-invite')]),{code:'42501'});
 const hash=digest('synthetic-ordinary-invite');await value("SELECT genie_create_invite($1,$2,'member',$3) value",[session(steward),invitee,hash]);
 const recipient=()=>db.query('SELECT * FROM genie_invite_recipient($1,$2,$3)',[hash,'https://accounts.example.test','subject-'+invitee]);
 assert.equal((await recipient()).rows.length,1);
 await save(admin,'Invitation creator',[],role.id,'1');assert.equal((await recipient()).rows.length,0);
 await assert.rejects(value('SELECT genie_accept_invite($1,$2,$3) value',[hash,'https://accounts.example.test','subject-'+invitee]),{code:'P0002'});
});
test('administrator invitations cease to be valid if the creator is demoted despite retained ordinary invitation grants',async()=>{
 const role=await save(admin,'Invitation creator',[grant('workspace.invitations','create')]);
 const hash=digest('synthetic-built-in-admin-invite');await value("SELECT genie_create_invite($1,$2,'admin',$3) value",[session(admin),invitee,hash]);
 // Root-only fixture mutation models a separate approved administrator's change.
 await db.query("UPDATE genie_memberships SET role='member' WHERE user_id=$1",[admin]);
 await db.query('INSERT INTO genie_member_roles VALUES($1,$2,$3)',[tenant,admin,role.id]);
 assert.equal((await db.query('SELECT * FROM genie_invite_recipient($1,$2,$3)',[hash,'https://accounts.example.test','subject-'+invitee])).rows.length,0);
});

test('role pages expose only the current tenant and distinguish read from editable scope',async()=>{
 const limited=await save(admin,'Roles viewer',[grant('workspace.roles','read')]);await assign(admin,reader,limited.id);
 await save(admin,'Membership manager',[grant('workspace.members','manage')]);await save(foreign,'Hidden other role',[]);
 const page=await value("SELECT genie_roles_page($1,'roles') value",[session(reader)]);
 assert.equal(page.items.length,2);assert.ok(page.items.every(r=>r.canManage===false&&r.canAssign===false));
 assert.equal(page.catalog.filter(c=>c.available).length,1);
 await assert.rejects(value("SELECT genie_roles_page($1,'roles') value",[session(plain)]),{code:'42501'});
 await assert.rejects(value("SELECT genie_roles_page($1,'assignments') value",[session(reader)]),{code:'42501'});
});
test('assignment pages require member read separately and have bounded non-overlapping cursors',async()=>{
 const scoped=await save(admin,'Role assigner',[grant('workspace.roles','assign')]);await assign(admin,steward,scoped.id);
 await assert.rejects(value("SELECT genie_roles_page($1,'assignments') value",[session(steward)]),{code:'42501'});
 for(let n=200;n<251;n++){
  const u=id(n);await db.query("INSERT INTO genie_users VALUES($1,'https://accounts.example.test',$2,true)",[u,'subject-'+u]);
  await db.query("INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference) VALUES($1,$2,'active','synthetic-page')",[u,tenant]);
  await db.query("INSERT INTO genie_workspace_people VALUES($1,$2,$3,'synthetic-page')",[tenant,u,'Page fixture '+n]);
 }
 const first=await value("SELECT genie_roles_page($1,'assignments',NULL,'Page fixture') value",[session(admin)]);
 assert.equal(first.items.length,50);assert.ok(first.nextCursor);
 const second=await value("SELECT genie_roles_page($1,'assignments',$2,'Page fixture') value",[session(admin),first.nextCursor]);
 assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);assert.ok(!first.items.some(x=>x.userId===second.items[0].userId));
});
test('policy audit pages retain actor, target, grants and event order without granting audit access to role readers',async()=>{
 const role=await save(admin,'Reader',[grant('workspace.members','read')]);await assign(admin,reader,role.id);await save(admin,'Reader',[],role.id,'1');
 const page=await value("SELECT genie_roles_page($1,'audit') value",[session(admin)]);
 assert.deepEqual(page.items.map(x=>x.action),['role_updated','role_assigned','role_created']);
 assert.equal(page.items[1].target,'Fixture '+reader);assert.deepEqual(page.items[0].before.grants,[grant('workspace.members','read')]);assert.deepEqual(page.items[0].after.grants,[]);
 await assert.rejects(value("SELECT genie_roles_page($1,'audit') value",[session(reader)]),{code:'42501'});
});

const exportsService=()=>new MemberExports(db);
const worker=(authenticateSession=async hash=>({sessionHash:hash,userId:reader,tenantId:tenant}))=>runMemberExport({exports:exportsService(),permissions:new Permissions(db),authenticateSession});
async function exportReader(){const role=await save(admin,'Export reader',[grant('workspace.members','read')]);await assign(admin,reader,role.id);return role;}
test('background export captures its server principal and reveals results only to its authorized creator',async()=>{
 await exportReader();const service=exportsService(),job=await service.enqueue(session(reader));
 assert.deepEqual(Object.keys(job).sort(),['id','status']);assert.equal(job.status,'queued');
 assert.equal((await worker()).status,'completed');const result=await service.get(session(reader),job.id);
 assert.equal(result.status,'completed');assert.equal(result.result.items.length,4);assert.equal(result.result.truncated,false);
 assert.ok(result.result.items.every(x=>Object.keys(x).sort().join(',')==='name,role,status'));
 await assert.rejects(service.get(session(admin),job.id),{status:404});
 await assert.rejects(service.get(session(foreign),job.id),{status:404});
 assert.equal((await worker()).status,'idle');
});
test('queued work is denied when role authority is removed before execution',async()=>{
 const role=await exportReader(),service=exportsService(),job=await service.enqueue(session(reader));
 await assign(admin,reader,role.id,false);assert.equal((await worker()).status,'denied');
 assert.equal(await value('SELECT result value FROM genie_member_exports WHERE id=$1',[job.id]),null);
 await assert.rejects(service.get(session(reader),job.id),{status:403});
});
test('database completion rechecks permission after the worker preflight, under the mutation lock',async()=>{
 const role=await exportReader(),service=exportsService(),job=await service.enqueue(session(reader)),lease=await service.claim();
 await new Permissions(db).require(session(reader),'workspace.members','read');
 await assign(admin,reader,role.id,false);
 assert.equal((await service.finish(job.id,lease.lease,'ready')).status,'denied');
 assert.equal(await value('SELECT result value FROM genie_member_exports WHERE id=$1',[job.id]),null);
});
test('worker revalidates upstream identity and rejects a changed actor without publishing data',async()=>{
 await exportReader();const service=exportsService();await service.enqueue(session(reader));
 assert.equal((await worker(async()=>{throw new HttpError(401,'authentication_required')})).status,'denied');
 await service.enqueue(session(reader));
 assert.equal((await worker(async hash=>({sessionHash:hash,userId:admin,tenantId:tenant}))).status,'denied');
 assert.equal(await value("SELECT count(*)::int value FROM genie_member_exports WHERE result IS NOT NULL"),0);
});
test('transient source failure retries at most three times with backoff and no retained result',async()=>{
 await exportReader();const service=exportsService(),job=await service.enqueue(session(reader));
 for(let attempt=1;attempt<=3;attempt++){
  const outcome=await worker(async()=>{throw new HttpError(503,'source_unavailable')});
  assert.equal(outcome.status,attempt===3?'failed':'queued');
  if(attempt<3){assert.equal((await worker()).status,'idle');await db.query('UPDATE genie_member_exports SET available_at=now() WHERE id=$1',[job.id]);}
 }
 assert.equal((await service.get(session(reader),job.id)).result,null);
});
test('leases reject stale completion, expire safely and stop at the deadline',async()=>{
 await exportReader();const service=exportsService(),job=await service.enqueue(session(reader)),first=await service.claim();
 await assert.rejects(service.finish(job.id,id(999),'ready'),{status:409});
 await db.query("UPDATE genie_member_exports SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[job.id]);
 const second=await service.claim();assert.notEqual(second.lease,first.lease);
 await assert.rejects(service.finish(job.id,first.lease,'ready'),{status:409});
 await db.query("UPDATE genie_member_exports SET deadline=now()-interval '1 second' WHERE id=$1",[job.id]);
 assert.equal((await service.finish(job.id,second.lease,'ready')).status,'failed');
 assert.equal((await service.get(session(reader),job.id)).result,null);
});
test('export queue enforces per-user bounds and never accepts an unauthorized producer',async()=>{
 await exportReader();const service=exportsService();
 await assert.rejects(service.enqueue(session(plain)),{status:403});
 for(let i=0;i<3;i++)await service.enqueue(session(reader));
 await assert.rejects(service.enqueue(session(reader)),{status:429});
 assert.equal(await value('SELECT count(*)::int value FROM genie_member_exports'),3);
});

test('revocation while the upstream session check is in flight prevents background execution',async()=>{
 const role=await exportReader(),service=exportsService();await service.enqueue(session(reader));
 const result=await worker(async hash=>{await assign(admin,reader,role.id,false);return{sessionHash:hash,userId:reader,tenantId:tenant};});
 assert.equal(result.status,'denied');
});
test('expired local sessions cannot complete previously queued exports',async()=>{
 await exportReader();const service=exportsService(),job=await service.enqueue(session(reader)),lease=await service.claim();
 await db.query("UPDATE genie_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[session(reader)]);
 assert.equal((await service.finish(job.id,lease.lease,'ready')).status,'denied');
});

test('actual PostgreSQL policy entry points cannot be replaced by direct runtime policy or audit writes',{skip:!realPostgres},async()=>{
 await db.exec("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='genie_policy_qualification') THEN CREATE ROLE genie_policy_qualification NOLOGIN; END IF; END $$; GRANT EXECUTE ON FUNCTION genie_current_capabilities(text),genie_save_role(text,uuid,text,jsonb,bigint),genie_assign_role(text,uuid,uuid,boolean,bigint),genie_enqueue_member_export(text),genie_get_member_export(text,uuid) TO genie_policy_qualification;");
 const client=await db.connect();
 try{
  await client.query('SET ROLE genie_policy_qualification');
  for(const sql of ['SELECT * FROM genie_member_exports','UPDATE genie_member_roles SET role_id=role_id WHERE false','DELETE FROM genie_permission_audit WHERE false','INSERT INTO genie_permission_catalog(resource,action) VALUES(\'other\',\'read\')','SELECT genie_claim_member_export()',"SELECT genie_has_permission(NULL,NULL,'workspace.members','read')"])
   await assert.rejects(client.query(sql),{code:'42501'});
  const caps=(await client.query('SELECT genie_current_capabilities($1) value',[session(admin)])).rows[0].value;assert.equal(caps.length,10);
  await assert.rejects(client.query('SELECT genie_save_role($1,NULL,$2,$3,NULL)',[session(plain),'Forbidden','[]']),{code:'42501'});
 }finally{await client.query('RESET ROLE');client.release();}
});
test('actual PostgreSQL role edits reject simultaneous stale versions rather than losing a grant change',{skip:!realPostgres},async()=>{
 const role=await save(admin,'Concurrent',[grant('workspace.members','read')]);
 const results=await Promise.allSettled([save(admin,'Concurrent A',[],role.id,'1'),save(admin,'Concurrent B',[grant('workspace.people','read')],role.id,'1')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'40001');
 assert.equal(await value("SELECT count(*)::int value FROM genie_permission_audit WHERE action='role_updated'"),1);
});
test('actual PostgreSQL workers claim a queued export only once under concurrent load',{skip:!realPostgres},async()=>{
 await exportReader();await exportsService().enqueue(session(reader));
 const claimed=await Promise.all([exportsService().claim(),exportsService().claim()]);assert.equal(claimed.filter(Boolean).length,1);
});
