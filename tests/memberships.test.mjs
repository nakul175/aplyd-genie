import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { digest, randomToken } from '../src/security.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),member=id(2),recipient=id(3),foreign=id(4),tenant=id(10),other=id(11);
const adminSession=digest('synthetic-admin-session'),memberSession=digest('synthetic-member-session'),foreignSession=digest('synthetic-foreign-session');
let db;
before(async()=>{
  db=new PGlite();
  for(const name of ['001_identity_sessions.sql','002_shared_rate_limits.sql','003_workspace_memberships.sql'])
    await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
});
after(async()=>{await db.close()});
beforeEach(async()=>{
  await db.exec('TRUNCATE genie_membership_audit,genie_membership_invites,genie_workspace_people,genie_sessions,genie_login_transactions,genie_memberships,genie_tenants,genie_users RESTART IDENTITY CASCADE');
  for(const user of [admin,member,recipient,foreign]) await db.query('INSERT INTO genie_users VALUES ($1,$2,$3,true)',[user,'https://accounts.example.test','subject-'+user]);
  for(const t of [tenant,other])await db.query('INSERT INTO genie_tenants VALUES ($1,true)',[t]);
  for(const [u,t,role] of [[admin,tenant,'admin'],[member,tenant,'member'],[foreign,other,'admin']])
    await db.query("INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference,role) VALUES ($1,$2,'active','synthetic-review',$3)",[u,t,role]);
  for(const u of [admin,member,recipient])await db.query("INSERT INTO genie_workspace_people VALUES ($1,$2,$3,'synthetic-directory-review')",[tenant,u,'Fixture '+u]);
  for(const [hash,u,t] of [[adminSession,admin,tenant],[memberSession,member,tenant],[foreignSession,foreign,other]])
    await db.query("INSERT INTO genie_sessions(token_hash,user_id,tenant_id,sealed_upstream,expires_at) VALUES ($1,$2,$3,'fixture-unused',now()+interval '1 hour')",[hash,u,t]);
});
const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.value;
const audit=async()=> (await db.query('SELECT * FROM genie_membership_audit ORDER BY id')).rows;
const change=(session,target,status='disabled',role='member')=>value('SELECT genie_change_member($1,$2,$3,$4) AS value',[session,target,status,role]);
async function invite(session=adminSession,target=recipient,role='member'){
  const token=randomToken(),hash=digest(token);
  const result=await value('SELECT genie_create_invite($1,$2,$3,$4) AS value',[session,target,role,hash]);
  return {...result,token,hash};
}
const accept=i=>value('SELECT genie_accept_invite($1,$2,$3) AS value',[i.hash,'https://accounts.example.test','subject-'+recipient]);

test('GENIE-3 AC1: ordinary members cannot invite or change membership',async()=>{
  await assert.rejects(change(memberSession,admin),{code:'42501'});
  await assert.rejects(invite(memberSession),{code:'42501'});
  assert.equal((await audit()).length,0);
});
test('administrators cannot mutate another tenant or invite a foreign identity',async()=>{
  await assert.rejects(change(adminSession,foreign),{code:'P0002'});
  await assert.rejects(invite(adminSession,foreign),{code:'P0002'});
  await assert.rejects(change(foreignSession,member),{code:'P0002'});
});
test('current session, membership, identity and administrator role are required at mutation time',async()=>{
  await db.query("UPDATE genie_memberships SET role='member' WHERE user_id=$1",[admin]);
  await assert.rejects(change(adminSession,member),{code:'42501'});
  await db.query("UPDATE genie_memberships SET role='admin',status='disabled' WHERE user_id=$1",[admin]);
  await assert.rejects(change(adminSession,member),{code:'42501'});
  await db.query("UPDATE genie_memberships SET status='active' WHERE user_id=$1",[admin]);
  await db.query('UPDATE genie_users SET enabled=false WHERE id=$1',[admin]);
  await assert.rejects(change(adminSession,member),{code:'42501'});
  await db.query('UPDATE genie_users SET enabled=true WHERE id=$1',[admin]);
  await db.query("UPDATE genie_sessions SET expires_at=now()-interval '1 second'");
  await assert.rejects(change(adminSession,member),{code:'42501'});
});
test('last active administrator cannot be removed or demoted',async()=>{
  await assert.rejects(change(adminSession,admin,'disabled','admin'),{code:'23514'});
  await assert.rejects(change(adminSession,admin,'active','member'),{code:'23514'});
  assert.equal((await audit()).length,0);
});
test('an administrator may step down when another enabled administrator remains',async()=>{
  await db.query("UPDATE genie_memberships SET role='admin' WHERE user_id=$1",[member]);
  assert.equal((await change(adminSession,admin,'disabled','admin')).changed,true);
  assert.equal((await db.query('SELECT * FROM genie_sessions WHERE token_hash=$1',[adminSession])).rows.length,0);
});
test('GENIE-3 AC2: deactivation removes target sessions and reactivation does not revive them',async()=>{
  assert.equal((await change(adminSession,member)).changed,true);
  assert.equal((await db.query('SELECT * FROM genie_sessions WHERE token_hash=$1',[memberSession])).rows.length,0);
  await assert.rejects(change(memberSession,admin),{code:'42501'});
  assert.equal((await change(adminSession,member,'active')).changed,true);
  assert.equal((await db.query('SELECT * FROM genie_sessions WHERE token_hash=$1',[memberSession])).rows.length,0);
});
test('no-op membership retries produce no duplicate audit event',async()=>{
  assert.equal((await change(adminSession,member,'active')).changed,false);
  await change(adminSession,member);
  assert.equal((await change(adminSession,member)).changed,false);
  assert.equal((await audit()).length,1);
});
test('GENIE-3 AC3: audit records bind actor, target, tenant and before/after atomically',async()=>{
  await change(adminSession,member);
  const [event]=await audit();
  assert.equal(event.actor_id,admin);assert.equal(event.target_id,member);assert.equal(event.tenant_id,tenant);
  assert.equal(event.action,'deactivated');
  assert.deepEqual(event.before_state,{status:'active',role:'member'});
  assert.deepEqual(event.after_state,{status:'disabled',role:'member'});
});
test('an audit failure rolls back the membership change and session deletion',async()=>{
  await db.exec("CREATE FUNCTION genie_fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER genie_fixture_audit_guard BEFORE INSERT ON genie_membership_audit FOR EACH ROW EXECUTE FUNCTION genie_fixture_audit_failure()");
  try {
    await assert.rejects(change(adminSession,member),{code:'P0001'});
    assert.equal((await db.query('SELECT status FROM genie_memberships WHERE user_id=$1',[member])).rows[0].status,'active');
    assert.equal((await db.query('SELECT * FROM genie_sessions WHERE token_hash=$1',[memberSession])).rows.length,1);
  } finally {await db.exec('DROP TRIGGER genie_fixture_audit_guard ON genie_membership_audit; DROP FUNCTION genie_fixture_audit_failure()')}
});
test('invitation hashes never appear in audit data and duplicate pending invitations conflict',async()=>{
  const i=await invite();
  await assert.rejects(invite(),{code:'23505'});
  const rows=await audit();assert.equal(rows.length,1);
  assert.ok(!JSON.stringify(rows).includes(i.hash));assert.ok(!JSON.stringify(rows).includes(i.token));
  assert.equal((await db.query('SELECT token_hash FROM genie_membership_invites')).rows[0].token_hash,i.hash);
});
test('only the exact reviewed issuer and subject can accept a single-use invitation',async()=>{
  const i=await invite();
  await assert.rejects(value('SELECT genie_accept_invite($1,$2,$3) AS value',[i.hash,'https://attacker.example','subject-'+recipient]),{code:'P0002'});
  await assert.rejects(value('SELECT genie_accept_invite($1,$2,$3) AS value',[i.hash,'https://accounts.example.test','subject-'+member]),{code:'P0002'});
  assert.deepEqual(await accept(i),{userId:recipient,tenantId:tenant});
  await assert.rejects(accept(i),{code:'P0002'});
  assert.equal((await audit()).length,2);
});
test('revoked and expired invitations cannot activate membership',async()=>{
  let i=await invite();
  await value('SELECT genie_revoke_invite($1,$2) AS value',[adminSession,i.id]);
  await assert.rejects(accept(i),{code:'P0002'});
  i=await invite();
  await db.query("UPDATE genie_membership_invites SET expires_at=now()-interval '1 second' WHERE id=$1",[i.id]);
  await assert.rejects(accept(i),{code:'P0002'});
  await invite();
  assert.equal((await audit()).filter(x=>x.action==='invitation_expired').length,1);
});
test('revoking the inviting administrator invalidates pending invitation authority',async()=>{
  const i=await invite();
  await db.query("UPDATE genie_memberships SET role='member' WHERE user_id=$1",[admin]);
  await assert.rejects(accept(i),{code:'P0002'});
});
test('membership entry points have no implicit PUBLIC execute grants',async()=>{
  const rows=await db.query("SELECT p.proname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.proname IN ('genie_admin_actor','genie_change_member','genie_create_invite','genie_revoke_invite','genie_invite_recipient','genie_accept_invite') AND a.grantee=0 AND a.privilege_type='EXECUTE'");
  assert.equal(rows.rows.length,0);
});
