import { HttpError, randomToken, digest } from './security.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function nativeId(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new HttpError(400, 'invalid_member');
  return value;
}
export class Memberships {
  constructor(database) { this.database = database; }
  async call(sql, args) {
    try { return (await this.database.query(sql,args)).rows[0]?.result; }
    catch(error) {
      const known = { '42501':[403,'administrator_required'], '23514':[409,'last_administrator_required'],
        '40001':[409,'membership_changed_refresh_required'], '23505':[409,'membership_conflict'], P0002:[404,'reviewed_membership_or_invitation_unavailable'],
        '22023':[400,'invalid_membership_request'], '22P02':[400,'invalid_membership_request'] }[error.code];
      if (known) throw new HttpError(...known);
      throw error;
    }
  }
  page(session, kind, after, search='') {
    if (!['members','people','invitations','audit'].includes(kind) || typeof search!=='string' || search.length>80 ||
      (after!==undefined && (typeof after!=='string'||after.length>64))) throw new HttpError(400,'invalid_membership_request');
    return this.call('SELECT genie_membership_page($1,$2,$3,$4) AS result',[session,kind,after??null,search]);
  }
  change(session,target,status,role,version) {
    if (!['active','disabled'].includes(status)||!['member','admin'].includes(role)) throw new HttpError(400,'invalid_membership_request');
    if (typeof version!=='string'||! /^[1-9][0-9]{0,18}$/.test(version)||BigInt(version)>9223372036854775807n) throw new HttpError(400,'invalid_membership_request');
    return this.call('SELECT genie_change_member($1,$2,$3,$4,$5) AS result',[session,nativeId(target),status,role,version]);
  }
  async invite(session,target,role) {
    if (!['member','admin'].includes(role)) throw new HttpError(400,'invalid_membership_request');
    const token=randomToken();
    const result=await this.call('SELECT genie_create_invite($1,$2,$3,$4) AS result',[session,nativeId(target),role,digest(token)]);
    return {...result,token};
  }
  revoke(session,id) { return this.call('SELECT genie_revoke_invite($1,$2) AS result',[session,nativeId(id)]); }
  async recipient(tokenHash,issuer,subject) {
    return (await this.database.query('SELECT * FROM genie_invite_recipient($1,$2,$3)',[tokenHash,issuer,subject])).rows[0];
  }
  accept(tokenHash,issuer,subject) {
    return this.call('SELECT genie_accept_invite($1,$2,$3) AS result',[tokenHash,issuer,subject]);
  }
}
