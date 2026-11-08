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
    '007_authorized_exports','008_workspace_sessions','009_workspace_conversations_search','010_portal_membership_bridge','011_portal_role_assignments','012_portal_provisioning'])
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


const freshSubject='new-central-subject';
const plan=()=>value('SELECT genie_portal_provision_preview($1,$2,$3,$4) value',[issuer,subject(actor),freshSubject,tenant]);
const provision=(expected,request=id(500))=>value('SELECT genie_portal_provision_create($1,$2,$3,$4,$5,$6::jsonb) value',[request,issuer,subject(actor),freshSubject,tenant,JSON.stringify(expected)]);

test('creation requires reviewed native admin and fresh exact subject, never links existing users',async()=>{
 await assert.rejects(plan(),{code:'42501'});await approve();
 const before=await plan();assert.equal(before.targetSubject,freshSubject);
 await assert.rejects(value('SELECT genie_portal_provision_preview($1,$2,$3,$4) value',[issuer,subject(actor),subject(target),tenant]),{code:'23505'});
 await db.query('UPDATE genie_users SET enabled=false WHERE id=$1',[target]);
 await assert.rejects(value('SELECT genie_portal_provision_preview($1,$2,$3,$4) value',[issuer,subject(actor),subject(target),tenant]),{code:'23505'});
});
test('fresh member has immutable proof marker, no custom roles and preserves existing identities',async()=>{
 await approve();const before=JSON.stringify((await db.query('SELECT * FROM genie_users ORDER BY id')).rows);
 const p=await plan(),result=await provision(p);assert.deepEqual(result,{before:p,after:{requestId:id(500),targetId:id(500),issuer,subject:freshSubject,tenantId:tenant,status:'active',role:'member',version:'1'}});
 const user=(await db.query('SELECT * FROM genie_users WHERE id=$1',[id(500)])).rows[0];assert.equal(user.portal_provision_request,id(500));assert.equal(user.portal_provision_tenant,tenant);
 assert.equal(await count('genie_member_roles'),0);assert.equal(await count('genie_portal_receipts'),1);
 assert.equal(JSON.stringify((await db.query('SELECT * FROM genie_users WHERE id<>$1 ORDER BY id',[id(500)])).rows),before);
 assert.deepEqual(await value('SELECT genie_portal_provision_status($1,$2,$3,$4) value',[issuer,freshSubject,tenant,id(500)]),{active:true});
 await db.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1",[id(500)]);
 assert.deepEqual(await value('SELECT genie_portal_provision_status($1,$2,$3,$4) value',[issuer,freshSubject,tenant,id(500)]),{active:false});
});
test('stale reviewer and duplicate create reject without modifying earlier accounts',async()=>{
 await approve();const p=await plan();await db.exec("UPDATE genie_portal_reviewers SET review_reference='changed review'");
 await assert.rejects(provision(p),{code:'40001'});assert.equal(await count('genie_users'),3);
 await provision(await plan());await assert.rejects(provision(p),{code:'23505'});assert.equal(await count('genie_users'),4);
});
test('receipt failure rolls back new native identity and membership atomically',async()=>{
 await approve();const p=await plan();await db.exec("CREATE FUNCTION fail_provision_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$; CREATE TRIGGER fail_provision BEFORE INSERT ON genie_portal_receipts FOR EACH ROW EXECUTE FUNCTION fail_provision_receipt()");
 try{await assert.rejects(provision(p),{code:'P0001'});assert.equal(await count('genie_users'),3);assert.equal(await count('genie_memberships'),3)}finally{await db.exec('DROP TRIGGER fail_provision ON genie_portal_receipts; DROP FUNCTION fail_provision_receipt()')}
});
test('private provisioning functions grant no runtime access',async()=>{
 for(const fn of ['genie_portal_provision_preview(text,text,text,uuid)','genie_portal_provision_create(uuid,text,text,text,uuid,jsonb)','genie_portal_provision_status(text,text,uuid,uuid)'])assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE') value",[reader,fn]),false);
});
test('real PostgreSQL competing creates produce one identity only',{skip:!realPostgres},async()=>{
 await approve();const p=await plan();const r=await Promise.allSettled([provision(p,id(500)),provision(p,id(501))]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(await count('genie_users'),4);assert.equal(await count('genie_portal_receipts'),1);
});
