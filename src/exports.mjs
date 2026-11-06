import {HttpError} from './security.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class MemberExports {
 constructor(database){this.database=database;}
 async call(sql,args=[]){
  try{return(await this.database.query(sql,args)).rows[0]?.result;}
  catch(error){const known={'42501':[403,'permission_required'],'53300':[429,'export_queue_full'],P0002:[404,'export_unavailable'],
   '40001':[409,'export_lease_unavailable'],'22023':[400,'invalid_export_request'],'22P02':[400,'invalid_export_request']}[error.code];
   if(known)throw new HttpError(...known);throw error;}
 }
 enqueue(session){return this.call('SELECT genie_enqueue_member_export($1) AS result',[session]);}
 claim(){return this.call('SELECT genie_claim_member_export() AS result');}
 finish(id,lease,outcome){return this.call('SELECT genie_finish_member_export($1,$2,$3) AS result',[id,lease,outcome]);}
 get(session,id){if(typeof id!=='string'||!uuid.test(id))throw new HttpError(400,'invalid_export_request');return this.call('SELECT genie_get_member_export($1,$2) AS result',[session,id]);}
}
/** The job's persisted actor is authenticated afresh; no permission snapshot is an execution grant. */
export async function runMemberExport({exports,authenticateSession,permissions}){
 const job=await exports.claim();if(!job)return{status:'idle'};
 let outcome='ready';
 try{
  const actor=await authenticateSession(job.sessionHash);
  if(actor.sessionHash!==job.sessionHash||actor.userId!==job.userId||actor.tenantId!==job.tenantId)throw new HttpError(403,'permission_required');
  await permissions.require(actor.sessionHash,'workspace.members','read');
 }catch(error){outcome=error instanceof HttpError&&[401,403].includes(error.status)?'denied':'retry';}
 // Local membership and permission are checked again under the tenant lock when building the result.
 return exports.finish(job.id,job.lease,outcome);
}
