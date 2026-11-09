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
    '007_authorized_exports','008_workspace_sessions','009_workspace_conversations_search','010_portal_membership_bridge','011_portal_role_assignments','012_portal_provisioning','013_portal_shared_roles'])
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
test('private role-definition functions are default denied',async()=>{
 for(const fn of ['genie_save_role_as_actor(uuid,uuid,uuid,text,jsonb,bigint)','genie_portal_role_definition_preview(text,text,text,uuid,uuid)','genie_portal_role_definition_change(uuid,text,text,text,uuid,uuid,jsonb,jsonb)'])assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE') value",[reader,fn]),false);
 await assert.rejects(definitionPreview(id(99)),{code:'42501'});
});
test('shared definition changes reach every assigned live session without changing assignments, identities or other roles',async()=>{
 await approve();const r=await role('Shared',read),unrelated=await role('Unrelated',[]);
 await db.query("INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference,role) VALUES($1,$2,'active','fixture','member')",[foreign,tenant]);
 await db.query("INSERT INTO genie_sessions(token_hash,user_id,tenant_id,sealed_upstream,expires_at) VALUES($1,$2,$3,'unused-fixture',now()+interval '1 hour')",[session('second'),foreign,tenant]);
 for(const u of [target,foreign])await value('SELECT genie_assign_role($1,$2,$3,true,1) value',[session(actor),u,r.id]);
 const preserve=async()=>JSON.stringify((await db.query('SELECT * FROM genie_users ORDER BY id')).rows)+JSON.stringify((await db.query('SELECT * FROM genie_sessions ORDER BY token_hash')).rows)+JSON.stringify((await db.query('SELECT * FROM genie_memberships ORDER BY tenant_id,user_id')).rows)+JSON.stringify((await db.query('SELECT * FROM genie_member_roles ORDER BY tenant_id,user_id,role_id')).rows)+JSON.stringify((await db.query('SELECT * FROM genie_roles WHERE id=$1',[unrelated.id])).rows);
 const before=await preserve();const preview=await definitionPreview(r.id);assert.equal(preview.affectedMembers.length,2);
 for(const [n,grants] of [[1,manage],[2,read],[3,[]]]){
  await definitionChange(r.id,grants,await definitionPreview(r.id),id(300+n));
  for(const token of [session(target),session('second')])assert.deepEqual(await value('SELECT genie_current_capabilities($1) value',[token]),[...grants].sort((a,b)=>a.action.localeCompare(b.action)));
 }
 assert.equal(await preserve(),before);assert.equal(await count('genie_portal_receipts'),3);
});
test('assignment-set, role, reviewer and target drift invalidate shared review',async()=>{
 await approve();const r=await role('Shared',read);let prior=await definitionPreview(r.id);
 await rolesChange(await rolesPreview(),[r.id]);await assert.rejects(definitionChange(r.id,[],prior),{code:'40001'});
 prior=await definitionPreview(r.id);await value('SELECT genie_save_role($1,$2,$3,$4::jsonb,$5) value',[session(actor),r.id,'Changed',JSON.stringify(read),r.version]);await assert.rejects(definitionChange(r.id,[],prior),{code:'40001'});
 prior=await definitionPreview(r.id);await db.exec('UPDATE genie_portal_reviewers SET enabled=false');await assert.rejects(definitionChange(r.id,[],prior),{code:'42501'});
 assert.equal(await count('genie_portal_receipts'),1);
});
test('foreign role, unknown capability and duplicate grants cannot change a shared definition',async()=>{
 await approve();const r=await role('Shared',read);const prior=await definitionPreview(r.id);
 await assert.rejects(definitionPreview(id(999)),{code:'P0002'});
 for(const grants of [[{resource:'workspace.unknown',action:'write'}],[...read,...read],{}])await assert.rejects(definitionChange(r.id,grants,prior));
 assert.deepEqual((await definitionPreview(r.id)).selectedRole.grants,read);assert.equal(await count('genie_portal_receipts'),0);
});
test('receipt insertion failure rolls back role definition; duplicate nonce cannot repeat',async()=>{
 await approve();const r=await role('Shared',read);const prior=await definitionPreview(r.id);
 await db.exec("CREATE FUNCTION fail_shared_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$; CREATE TRIGGER fail_shared_receipt BEFORE INSERT ON genie_portal_receipts FOR EACH ROW EXECUTE FUNCTION fail_shared_receipt()");
 try{await assert.rejects(definitionChange(r.id,[],prior));assert.deepEqual(await definitionPreview(r.id),prior);}finally{await db.exec('DROP TRIGGER fail_shared_receipt ON genie_portal_receipts; DROP FUNCTION fail_shared_receipt()');}
 await definitionChange(r.id,[],prior);await assert.rejects(definitionChange(r.id,read,await definitionPreview(r.id)),{code:'23505'});
});
