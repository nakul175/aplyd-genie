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
    '007_authorized_exports','008_workspace_sessions','009_workspace_conversations_search','010_portal_membership_bridge','011_portal_role_assignments'])
    await db.exec(await readFile(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
  await db.exec(`CREATE ROLE ${reader} NOLOGIN`);
});
after(async()=>{try{if(db&&reader)await db.exec(`DROP ROLE IF EXISTS ${reader}`)}finally{await db?.close()}});
beforeEach(async()=>{
  await db.exec('TRUNCATE genie_users,genie_tenants RESTART IDENTITY CASCADE');
  for(const u of [actor,target,foreign])await db.query('INSERT INTO genie_users VALUES($1,$2,$3,true)',[u,issuer,subject(u)]);
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

test('new private role bridge grants no runtime access and requires reviewed administrator',async()=>{
 await assert.rejects(rolesPreview(),{code:'42501'});
 for(const fn of ['genie_portal_roles_preview(text,text,text,uuid)','genie_portal_roles_change(uuid,text,text,text,uuid,jsonb,jsonb)','genie_assign_role_as_actor(uuid,uuid,uuid,uuid,boolean,bigint)'])
  assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE') value",[reader,fn]),false);
});
test('same native session observes grant downgrade and revoke without membership or identity changes',async()=>{
 await approve();const read=await role('Read members',[{resource:'workspace.members',action:'read'}]);
 const manage=await role('Manage members',[{resource:'workspace.members',action:'manage'}]);
 const protectedState=async()=>JSON.stringify((await db.query('SELECT * FROM genie_users ORDER BY id')).rows)+JSON.stringify((await db.query('SELECT * FROM genie_sessions ORDER BY token_hash')).rows)+JSON.stringify((await db.query('SELECT * FROM genie_roles ORDER BY id')).rows)+JSON.stringify((await db.query('SELECT * FROM genie_role_permissions ORDER BY role_id,resource,action')).rows);
 const before=await protectedState();assert.deepEqual(await caps(),[]);
 await rolesChange(await rolesPreview(),[read.id,manage.id]);assert.equal((await caps()).length,2);
 await rolesChange(await rolesPreview(),[read.id],id(201));assert.deepEqual(await caps(),[{resource:'workspace.members',action:'read'}]);
 await rolesChange(await rolesPreview(),[],id(202));assert.deepEqual(await caps(),[]);
 assert.equal(await protectedState(),before);assert.equal(await count('genie_memberships'),3);
 assert.equal(await count('genie_permission_audit'),6);assert.equal(await count('genie_portal_receipts'),3);
});
test('native role assignments and Portal share the same assignment policy and versions',async()=>{
 await approve();const r=await role('Reader',[{resource:'workspace.members',action:'read'}]);
 const before=await rolesPreview();await value('SELECT genie_assign_role($1,$2,$3,true,1) value',[session(actor),target,r.id]);
 await assert.rejects(rolesChange(before,[r.id]),{code:'40001'});
 assert.equal((await rolesPreview()).version,'2');
 await rolesChange(await rolesPreview(),[]);assert.deepEqual(await caps(),[]);
});
test('changed role definition reviewer or target status invalidates reviewed save',async()=>{
 await approve();const r=await role('Reader',[{resource:'workspace.members',action:'read'}]);let before=await rolesPreview();
 await value('SELECT genie_save_role($1,$2,$3,$4::jsonb,$5) value',[session(actor),r.id,'Renamed',JSON.stringify([{resource:'workspace.members',action:'read'}]),r.version]);
 await assert.rejects(rolesChange(before,[r.id]),{code:'40001'});
 before=await rolesPreview();await db.exec('UPDATE genie_portal_reviewers SET enabled=false');
 await assert.rejects(rolesChange(before,[r.id]),{code:'42501'});await db.exec('UPDATE genie_portal_reviewers SET enabled=true');
 before=await rolesPreview();await db.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1",[target]);
 await assert.rejects(rolesChange(before,[r.id]),{code:'42501'});assert.equal(await count('genie_member_roles'),0);
});
test('foreign duplicate invalid or excessive role selections cannot mutate',async()=>{
 await approve();const r=await role('Reader',[{resource:'workspace.members',action:'read'}]);const before=await rolesPreview();
 for(const roles of [[id(999)],[r.id,r.id],Array(17).fill(r.id),[null],{}])await assert.rejects(rolesChange(before,roles));
 assert.equal(await count('genie_member_roles'),0);assert.equal(await count('genie_portal_receipts'),0);
});
test('built-in administrator target and disabled account are never edited by custom roles',async()=>{
 await approve();await db.query("UPDATE genie_memberships SET role='admin' WHERE user_id=$1",[target]);await assert.rejects(rolesPreview(),{code:'42501'});
 await db.query("UPDATE genie_memberships SET role='member' WHERE user_id=$1",[target]);await db.query('UPDATE genie_users SET enabled=false WHERE id=$1',[target]);await assert.rejects(rolesPreview(),{code:'42501'});
});
test('single-use receipt replay and atomic receipt failure do not double-change assignments',async()=>{
 await approve();const r=await role('Reader',[{resource:'workspace.members',action:'read'}]);
 const before=await rolesPreview();await rolesChange(before,[r.id]);await assert.rejects(rolesChange(await rolesPreview(),[]),{code:'23505'});
 await db.exec("CREATE FUNCTION fail_role_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$; CREATE TRIGGER fail_role_receipt BEFORE INSERT ON genie_portal_receipts FOR EACH ROW EXECUTE FUNCTION fail_role_receipt()");
 try{await assert.rejects(rolesChange(await rolesPreview(),[],id(201)));assert.equal(await count('genie_member_roles'),1);assert.equal((await rolesPreview()).version,'2');}
 finally{await db.exec('DROP TRIGGER fail_role_receipt ON genie_portal_receipts; DROP FUNCTION fail_role_receipt()');}
});

test('real PostgreSQL competing reviewed role saves have exactly one winner',{skip:!realPostgres},async()=>{
 await approve();const read=await role('Read',[{resource:'workspace.members',action:'read'}]);const manage=await role('Manage',[{resource:'workspace.members',action:'manage'}]);
 const before=await rolesPreview();
 const outcomes=await Promise.allSettled([rolesChange(before,[read.id],id(210)),rolesChange(before,[manage.id],id(211))]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'40001');assert.equal(await count('genie_portal_receipts'),1);
});
