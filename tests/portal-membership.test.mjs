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
    '007_authorized_exports','008_workspace_sessions','009_workspace_conversations_search','010_portal_membership_bridge'])
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

test('migration alone approves no reviewer and grants no runtime function or table access',async()=>{
  await assert.rejects(preview(),{code:'42501'});
  for(const fn of ['genie_portal_membership_preview(text,text,text,uuid)',
    'genie_portal_membership_change(uuid,text,text,text,uuid,text,text,jsonb)',
    'genie_change_member_as_actor(uuid,uuid,text,uuid,text,text,bigint)'])
    assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE') value",[reader,fn]),false);
  assert.equal(await value("SELECT has_table_privilege($1,'genie_portal_reviewers','SELECT,INSERT,UPDATE,DELETE') value",[reader]),false);
  assert.equal(await count('genie_portal_receipts'),0);
});
test('exact issuer/subject and workspace scope are required; no email or fallback identity',async()=>{
  await approve();
  await assert.rejects(preview(actor,target,tenant,issuer+'/'),{code:'42501'});
  await assert.rejects(preview(actor,foreign),{code:'P0002'});
  await assert.rejects(preview(actor,target,other),{code:'42501'});
  await assert.rejects(preview(target,target),{code:'42501'});
});
test('disabled reviewer, native administrator or tenant fails closed',async()=>{
  await approve();
  for(const [sql,undo] of [
    ['UPDATE genie_portal_reviewers SET enabled=false','UPDATE genie_portal_reviewers SET enabled=true'],
    [`UPDATE genie_users SET enabled=false WHERE id='${actor}'`,`UPDATE genie_users SET enabled=true WHERE id='${actor}'`],
    [`UPDATE genie_memberships SET role='member' WHERE user_id='${actor}'`,`UPDATE genie_memberships SET role='admin' WHERE user_id='${actor}'`],
    [`UPDATE genie_tenants SET enabled=false WHERE id='${tenant}'`,`UPDATE genie_tenants SET enabled=true WHERE id='${tenant}'`]]){
    await db.exec(sql);await assert.rejects(preview(),{code:'42501'});await db.exec(undo);
  }
});
test('grant/downgrade/revoke/regrant preserve native identities and custom assignments; old sessions never revive',async()=>{
  await approve();
  const role=await value('SELECT genie_save_role($1,NULL,$2,$3::jsonb,NULL) value',
    [session(actor),'Existing reader',JSON.stringify([{resource:'workspace.members',action:'read'}])]);
  await value('SELECT genie_assign_role($1,$2,$3,true,1) value',[session(actor),target,role.id]);
  const protectedRows=async()=>JSON.stringify((await db.query('SELECT * FROM genie_users ORDER BY id')).rows)+
    JSON.stringify((await db.query('SELECT * FROM genie_member_roles ORDER BY tenant_id,user_id,role_id')).rows)+
    JSON.stringify((await db.query('SELECT * FROM genie_role_permissions ORDER BY tenant_id,role_id,resource,action')).rows)+
    JSON.stringify((await db.query('SELECT * FROM genie_sessions WHERE user_id<>$1 ORDER BY token_hash',[target])).rows);
  const before=await protectedRows();
  let state=await preview();assert.equal(state.customRoles.length,1);
  assert.equal((await change(state)).changed,true);
  assert.equal(await value('SELECT count(*)::int value FROM genie_sessions WHERE user_id=$1',[target]),0);
  await change(await preview(),'active','member',id(101));
  await change(await preview(),'disabled','member',id(102));
  assert.equal((await preview()).status,'disabled');
  await change(await preview(),'active','member',id(103));
  assert.equal(await value('SELECT count(*)::int value FROM genie_sessions WHERE user_id=$1',[target]),0);
  assert.equal(await protectedRows(),before);
  assert.equal(await count('genie_portal_receipts'),4);
  assert.equal(await count('genie_memberships'),3);
});
test('native built-in role change and Portal change have the same policy side effects',async()=>{
  await approve();
  const native=await value("SELECT genie_change_member($1,$2,'active','admin',1) value",[session(actor),target]);
  const nativeRow=await preview();assert.equal(native.changed,true);assert.equal(nativeRow.role,'admin');
  await change(nativeRow,'active','member');
  assert.equal((await preview()).role,'member');
  assert.equal(await count('genie_membership_audit'),2);
});
test('last active administrator cannot be downgraded or disabled through Portal',async()=>{
  await approve();const state=await preview(actor,actor);
  await assert.rejects(change(state,'active','member',id(100),actor,actor),{code:'23514'});
  await assert.rejects(change(state,'disabled','admin',id(101),actor,actor),{code:'23514'});
  assert.equal(await count('genie_portal_receipts'),0);
  assert.equal(await count('genie_membership_audit'),0);
  assert.equal(await count('genie_sessions'),3);
});
test('stale target state and re-approved reviewer reject the old plan without changing data',async()=>{
  await approve();const state=await preview();
  await db.exec('UPDATE genie_portal_reviewers SET enabled=false; UPDATE genie_portal_reviewers SET enabled=true');
  assert.notEqual((await preview()).reviewerVersion,state.reviewerVersion);
  await assert.rejects(change(state),{code:'40001'});
  const fresh=await preview();await db.query('UPDATE genie_memberships SET version=version+1 WHERE user_id=$1',[target]);
  await assert.rejects(change(fresh),{code:'40001'});
  assert.equal(await count('genie_portal_receipts'),0);
});
test('custom role and catalogue drift reject a review before dispatch',async()=>{
  await approve();const state=await preview();
  await db.query("INSERT INTO genie_permission_catalog VALUES('workspace.synthetic','read')");
  await assert.rejects(change(state),{code:'40001'});
  await db.query("DELETE FROM genie_permission_catalog WHERE resource='workspace.synthetic'");
  assert.equal(await count('genie_membership_audit'),0);
});
test('disabled target cannot receive a grant, while revoke preserves its membership record',async()=>{
  await approve();await db.query('UPDATE genie_users SET enabled=false WHERE id=$1',[target]);
  await assert.rejects(change(await preview()),{code:'22023'});
  await change(await preview(),'disabled','member');
  assert.equal(await count('genie_memberships'),3);
  assert.equal((await preview()).status,'disabled');
});
test('replay cannot reapply a mutation and an unchanged request does not revoke sessions',async()=>{
  await approve();const state=await preview();
  assert.equal((await change(state,'active','member')).changed,false);
  await assert.rejects(change(state,'active','member'),{code:'23505'});
  assert.equal(await count('genie_sessions'),3);assert.equal(await count('genie_membership_audit'),0);
});
test('malformed expected state and unknown role never write a receipt or membership',async()=>{
  await approve();const state=await preview();
  await assert.rejects(change({...state,targetId:foreign}),{code:'40001'});
  await assert.rejects(change(state,'active','owner'),{code:'22023'});
  await assert.rejects(change(null),{code:'40001'});
  assert.equal(await count('genie_portal_receipts'),0);assert.equal((await preview()).role,'member');
});

test('real PostgreSQL: competing last-administrator removals serialize and preserve one administrator',
  {skip:!realPostgres},async()=>{
  await approve();
  await db.query("UPDATE genie_memberships SET role='admin' WHERE user_id=$1",[target]);
  await db.query("INSERT INTO genie_portal_reviewers(tenant_id,user_id,enabled,review_reference) VALUES($1,$2,true,'synthetic-owner-review')",[tenant,target]);
  const a=await preview(actor,actor),b=await preview(target,target);
  const results=await Promise.allSettled([
    change(a,'disabled','admin',id(201),actor,actor),
    change(b,'disabled','admin',id(202),target,target),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'23514');
  assert.equal(await value("SELECT count(*)::int value FROM genie_memberships WHERE tenant_id=$1 AND status='active' AND role='admin'",[tenant]),1);
  assert.equal(await count('genie_portal_receipts'),1);
});

test('real PostgreSQL: dedicated caller can use reviewed bridge but cannot write tables or invoke private policy helper',
  {skip:!realPostgres},async()=>{
  await approve();
  const functions='genie_portal_membership_preview(text,text,text,uuid),genie_portal_membership_change(uuid,text,text,text,uuid,text,text,jsonb)';
  await db.exec(`GRANT EXECUTE ON FUNCTION ${functions} TO ${reader}`);
  const connection=await db.connect();
  try{
    await connection.query(`SET ROLE ${reader}`);
    const plan=(await connection.query('SELECT genie_portal_membership_preview($1,$2,$3,$4) value',[issuer,subject(actor),subject(target),tenant])).rows[0].value;
    await assert.rejects(connection.query('UPDATE genie_memberships SET role=\'admin\''),{code:'42501'});
    await assert.rejects(connection.query('SELECT * FROM genie_portal_reviewers'),{code:'42501'});
    await assert.rejects(connection.query("SELECT genie_change_member_as_actor($1,$2,'admin',$3,'active','admin',1)",[actor,tenant,target]),{code:'42501'});
    const result=(await connection.query('SELECT genie_portal_membership_change($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',
      [id(300),issuer,subject(actor),subject(target),tenant,'active','admin',JSON.stringify(plan)])).rows[0].value;
    assert.equal(result.changed,true);
  }finally{
    await connection.query('RESET ROLE');connection.release();
    await db.exec(`REVOKE EXECUTE ON FUNCTION ${functions} FROM ${reader}`);
  }
});

test('real PostgreSQL: an already-revoked reviewer cannot dispatch a previously reviewed change',
  {skip:!realPostgres},async()=>{
  await approve();const plan=await preview();
  const connection=await db.connect();
  try{
    await connection.query('BEGIN');
    await connection.query("SELECT pg_advisory_xact_lock(hashtextextended('genie-membership:'||$1::text,0))",[tenant]);
    await connection.query('UPDATE genie_portal_reviewers SET enabled=false WHERE tenant_id=$1',[tenant]);
    const pending=change(plan).then(()=>({success:true}),error=>({error}));
    await connection.query('COMMIT');
    const result=await pending;
    assert.equal(result.error?.code,'42501');
    assert.equal(await count('genie_portal_receipts'),0);
    assert.equal(await value('SELECT role value FROM genie_memberships WHERE user_id=$1',[target]),'member');
  }finally{await connection.query('ROLLBACK');connection.release()}
});
