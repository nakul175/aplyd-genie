import {HttpError} from './security.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid=()=>new HttpError(400,'invalid_role_request');
const native=value=>{if(typeof value!=='string'||!uuid.test(value))throw invalid();return value;};
const version=value=>{
 if(typeof value!=='string'||! /^[1-9][0-9]{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)throw invalid();
 return value;
};
export function roleGrants(value){
 if(!Array.isArray(value)||value.length>32)throw invalid();
 const seen=new Set();
 for(const grant of value){
  if(!grant||typeof grant!=='object'||Array.isArray(grant)||Object.keys(grant).sort().join(',')!=='action,resource'||
   typeof grant.resource!=='string'||! /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){1,4}$/.test(grant.resource)||grant.resource.length>100||
   typeof grant.action!=='string'||! /^[a-z][a-z_]{0,39}$/.test(grant.action))throw invalid();
  const key=grant.resource+':'+grant.action;if(seen.has(key))throw invalid();seen.add(key);
 }
 return value;
}
/** Only the current database policy grants authority. Callers supply a server-derived session hash. */
export class Permissions {
 constructor(database){this.database=database;}
 async call(sql,session,args=[]){
  if(typeof session!=='string'||! /^[a-f0-9]{64}$/.test(session))throw new HttpError(401,'authentication_required');
  try{return(await this.database.query(sql,[session,...args])).rows[0]?.result;}
  catch(error){
   const known={'42501':[403,'permission_required'],'22023':[400,'invalid_role_request'],'22P02':[400,'invalid_role_request'],
    '23505':[409,'role_name_conflict'],'40001':[409,'role_or_membership_changed_refresh_required'],'23514':[409,'role_or_assignment_limit'],
    P0002:[404,'role_or_member_unavailable']}[error.code];
   if(known)throw new HttpError(...known);throw error;
  }
 }
 capabilities(session){return this.call('SELECT genie_current_capabilities($1) AS result',session);}
 async require(session,resource,action){
  const current=await this.capabilities(session);
  if(!current?.some(grant=>grant.resource===resource&&grant.action===action))throw new HttpError(403,'permission_required');
 }
 page(session,kind='roles',after,search=''){
  if(!['roles','assignments','audit'].includes(kind)||typeof search!=='string'||search.length>80||
   (after!==undefined&&(typeof after!=='string'||after.length>64||kind==='roles')))throw invalid();
  return this.call('SELECT genie_roles_page($1,$2,$3,$4) AS result',session,[kind,after??null,search]);
 }
 save(session,{roleId=null,name,grants,version:expected}={}){
  if(typeof name!=='string'||name.length<1||name.length>80||name!==name.trim()||/[\u0000-\u001f\u007f]/.test(name))throw invalid();
  return this.call('SELECT genie_save_role($1,$2,$3,$4::jsonb,$5) AS result',session,
   [roleId===null?null:native(roleId),name,JSON.stringify(roleGrants(grants)),roleId===null?null:version(expected)]);
 }
 assign(session,{target,roleId,assigned,version:expected}={}){
  if(typeof assigned!=='boolean')throw invalid();
  return this.call('SELECT genie_assign_role($1,$2,$3,$4,$5) AS result',session,
   [native(target),native(roleId),assigned,version(expected)]);
 }
}
