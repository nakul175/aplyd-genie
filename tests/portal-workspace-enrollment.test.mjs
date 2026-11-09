import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {digest} from '../src/security.mjs';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const issuer='https://accounts.example.test',actor=id(1),target=id(2),foreign=id(3),tenant=id(10),other=id(11);
const subject=u=>'fixture-'+u,session=u=>digest('portal-qualification-'+u);
let db,reader;
const realPostgres=Boolean(process.env.GENIE_TEST_DATABASE_URL);
before(async()=>{
  if(realPostgres){
    const url=new URL(process.env.GENIE_TEST_DATABASE_URL);
    assert.ok(url.protocol==='postgresql:' && url.hostname==='127.0.0.1' && /^\/genie_qual_[a-z0-9_]+$/.test(url.pathname),
      'Refusing tests outside an explicitly named loopback qualification database');
    const {default:pg}=await import('pg');
    const ssl=process.env.GENIE_TEST_CA ? {ca:await readFile(process.env.GENIE_TEST_CA,'utf8'),rejectUnauthorized:true,servername:'db'}:undefined;
    const pool=new pg.Pool({connectionString:url.href,ssl,max:4,connectionTimeoutMillis:3000,statement_timeout:5000});
    db={query:pool.query.bind(pool),exec:pool.query.bind(pool),close:pool.end.bind(pool),connect:pool.connect.bind(pool)};
    assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0);
    reader='portal_reader_'+url.pathname.slice('/genie_qual_'.length);
  }else{db=new PGlite();reader='portal_qualification_reader';}
  for(const name of ['001_identity_sessions','002_shared_rate_limits','003_workspace_memberships',
    '004_audit_page_cursor','005_resource_permissions','006_permission_aware_memberships',
    '007_authorized_exports','008_workspace_sessions','009_workspace_conversations_search','010_portal_membership_bridge','011_portal_role_assignments','012_portal_provisioning','013_portal_shared_roles','014_portal_workspace_enrollment'])
    await db.exec(await readFile(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
  await db.exec(`CREATE ROLE ${reader} NOLOGIN`);
});
after(async()=>{try{if(db&&reader)await db.exec(`DROP ROLE IF EXISTS ${reader}`)}finally{await db?.close()}});
beforeEach(async()=>{
  await db.exec('TRUNCATE genie_users,genie_tenants RESTART IDENTITY CASCADE');
  for(const u of [actor,target,foreign])await db.query('INSERT INTO genie_users(id,issuer,subject,enabled) VALUES($1,$2,$3,true)',[u,issuer,subject(u)]);
  for(const t of [tenant,other])await db.query('INSERT INTO genie_tenants VALUES($1,true)',[t]);
  for(const [u,t,r] of [[actor,tenant,'admin'],[target,tenant,'member'],[foreign,other,'admin']]){
    await db.query("INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference,role) VALUES($1,$2,'active','synthetic-reviewed',$3)",[u,t,r]);
    await db.query("INSERT INTO genie_sessions(token_hash,user_id,tenant_id,sealed_upstream,expires_at) VALUES($1,$2,$3,'unused-fixture',now()+interval '1 hour')",[session(u),u,t]);
  }
});
const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.value;
const approve=()=>db.query("INSERT INTO genie_portal_reviewers(tenant_id,user_id,enabled,review_reference) VALUES($1,$2,true,'synthetic-owner-review')",[tenant,actor]);
const preview=(a=actor,t=target,space=tenant,iss=issuer)=>value('SELECT genie_portal_membership_preview($1,$2,$3,$4) value',[iss,subject(a),subject(t),space]);
const change=(expected,status='active',role='admin',request=id(100),a=actor,t=target)=>value(
  'SELECT genie_portal_membership_change($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',
  [request,issuer,subject(a),subject(t),tenant,status,role,JSON.stringify(expected)]);
const count=table=>value(`SELECT count(*)::int value FROM ${table}`);


const rolesPreview=()=>value('SELECT genie_portal_roles_preview($1,$2,$3,$4) value',[issuer,subject(actor),subject(target),tenant]);
const rolesChange=(expected,roles,request=id(200))=>value('SELECT genie_portal_roles_change($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) value',
 [request,issuer,subject(actor),subject(target),tenant,JSON.stringify(roles),JSON.stringify(expected)]);
const role=async(name,grants)=>value('SELECT genie_save_role($1,NULL,$2,$3::jsonb,NULL) value',[session(actor),name,JSON.stringify(grants)]);
const caps=()=>value('SELECT genie_current_capabilities($1) value',[session(target)]);


const definitionPreview=r=>value('SELECT genie_portal_role_definition_preview($1,$2,$3,$4,$5) value',[issuer,subject(actor),subject(target),tenant,r]);
const definitionChange=(r,grants,expected,request=id(300))=>value('SELECT genie_portal_role_definition_change($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) value',[request,issuer,subject(actor),subject(target),tenant,r,JSON.stringify(grants),JSON.stringify(expected)]);
const read=[{resource:'workspace.members',action:'read'}],manage=[...read,{resource:'workspace.members',action:'manage'}];

const enrollmentPreview=()=>value('SELECT genie_portal_enrollment_preview($1,$2,$3,$4) value',[issuer,subject(actor),subject(foreign),tenant]);
const enroll=(expected,request=id(400))=>value('SELECT genie_portal_enrollment_create($1,$2,$3,$4,$5,$6::jsonb) value',[request,issuer,subject(actor),subject(foreign),tenant,JSON.stringify(expected)]);
test('private enrollment and explicit existing-identity only',async()=>{
 for(const fn of ['genie_portal_enrollment_preview(text,text,text,uuid)','genie_portal_enrollment_create(uuid,text,text,text,uuid,jsonb)'])assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE') value",[reader,fn]),false);
 await assert.rejects(enrollmentPreview(),{code:'42501'});await approve();
 await assert.rejects(value('SELECT genie_portal_enrollment_preview($1,$2,$3,$4) value',[issuer,subject(actor),'missing',tenant]),{code:'P0002'});
});
test('adds only a second Member membership; same existing session capabilities follow grants downgrade revoke',async()=>{
 await approve();const before=JSON.stringify((await db.query('SELECT * FROM genie_users ORDER BY id')).rows);
 const old=JSON.stringify((await db.query('SELECT * FROM genie_memberships WHERE tenant_id=$1 ORDER BY user_id',[other])).rows);
 const p=await enrollmentPreview(),r=await enroll(p);assert.equal(r.after.role,'member');assert.equal(r.after.targetId,foreign);
 assert.equal(await count('genie_users'),3);assert.equal(JSON.stringify((await db.query('SELECT * FROM genie_users ORDER BY id')).rows),before);
 assert.equal(JSON.stringify((await db.query('SELECT * FROM genie_memberships WHERE tenant_id=$1 ORDER BY user_id',[other])).rows),old);
 await db.query("INSERT INTO genie_sessions(token_hash,user_id,tenant_id,sealed_upstream,expires_at) VALUES($1,$2,$3,'unused',now()+interval '1 hour')",[session('new-workspace'),foreign,tenant]);
 const reader=await role('Reader',read),manager=await role('Manager',manage);
 for(const [n,ids] of [[1,[manager.id]],[2,[reader.id]],[3,[]]]){
  const b=await value('SELECT genie_portal_roles_preview($1,$2,$3,$4) value',[issuer,subject(actor),subject(foreign),tenant]);
  await value('SELECT genie_portal_roles_change($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) value',[id(410+n),issuer,subject(actor),subject(foreign),tenant,JSON.stringify(ids),JSON.stringify(b)]);
  const c=await value('SELECT genie_current_capabilities($1) value',[session('new-workspace')]);assert.equal(c.some(x=>x.resource==='workspace.members'&&x.action==='manage'),n===1);assert.equal(c.some(x=>x.resource==='workspace.members'&&x.action==='read'),n!==3);
 }
 assert.equal(JSON.stringify((await db.query('SELECT * FROM genie_memberships WHERE tenant_id=$1 ORDER BY user_id',[other])).rows),old);
});
test('existing or disabled membership, stale review and disabled identity fail closed',async()=>{
 await approve();const p=await enrollmentPreview();await db.exec("UPDATE genie_portal_reviewers SET version=2");await assert.rejects(enroll(p),{code:'40001'});
 await db.query('UPDATE genie_users SET enabled=false WHERE id=$1',[foreign]);await assert.rejects(enrollmentPreview(),{code:'P0002'});await db.query('UPDATE genie_users SET enabled=true WHERE id=$1',[foreign]);
 await enroll(await enrollmentPreview());await assert.rejects(enrollmentPreview(),{code:'23505'});await db.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1 AND tenant_id=$2",[foreign,tenant]);await assert.rejects(enrollmentPreview(),{code:'23505'});
});
test('receipt failure rolls back second membership and audit',async()=>{
 await approve();const p=await enrollmentPreview();await db.exec("CREATE FUNCTION fail_enrollment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$; CREATE TRIGGER fail_enrollment_receipt BEFORE INSERT ON genie_portal_receipts FOR EACH ROW EXECUTE FUNCTION fail_enrollment_receipt()");
 try{await assert.rejects(enroll(p));assert.deepEqual(await enrollmentPreview(),p);assert.equal(await count('genie_membership_audit'),0)}finally{await db.exec('DROP TRIGGER fail_enrollment_receipt ON genie_portal_receipts; DROP FUNCTION fail_enrollment_receipt()')}
});
test('invited provenance retained while per-workspace proof is distinct',async()=>{
 await approve();await db.query('UPDATE genie_users SET portal_provision_request=$1,portal_provision_tenant=$2 WHERE id=$1',[foreign,other]);
 const p=await enrollmentPreview();assert.equal(p.originRequest,foreign);assert.equal(p.originTenant,other);await enroll(p);
 const {IdentityStore}=await import('../src/store.mjs');const store=new IdentityStore(db);
 assert.deepEqual(await store.provisioning(foreign,tenant),{requestId:id(400),tenantId:tenant,kind:'workspace-enrollment'});
 assert.deepEqual(await store.provisioning(foreign,other),{requestId:foreign,tenantId:other});
});

test('pending native invitation requires reconciliation, never silently superseded',async()=>{
 await approve();await db.query("INSERT INTO genie_membership_invites(tenant_id,recipient_id,created_by,role,token_hash,expires_at) VALUES($1,$2,$3,'admin',$4,now()+interval '1 hour')",[tenant,foreign,actor,'a'.repeat(64)]);await assert.rejects(enrollmentPreview(),{code:'23505'});assert.equal(await count('genie_portal_receipts'),0);
});
test('real PostgreSQL competing enrollment creates one Member and receipt',{skip:!realPostgres},async()=>{
 await approve();const p=await enrollmentPreview();const outcomes=await Promise.allSettled([enroll(p,id(600)),enroll(p,id(601))]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(await count('genie_portal_receipts'),1);assert.equal((await db.query('SELECT count(*)::int n FROM genie_memberships WHERE user_id=$1 AND tenant_id=$2',[foreign,tenant])).rows[0].n,1);
});
