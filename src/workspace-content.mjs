import {HttpError} from './security.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const controls=/[\u0000-\u001f\u007f]/;
const invalid=()=>new HttpError(400,'invalid_workspace_content');
function recordId(value){if(typeof value!=='string'||!uuid.test(value))throw invalid();return value;}
function clean(value,min,max){
 if(typeof value!=='string')throw invalid();const text=value.trim();
 if(text.length<min||text.length>max||controls.test(text))throw invalid();return text;
}
function message(value){if(typeof value!=='string'||value.length>4096||!value.trim()||value.includes('\u0000'))throw invalid();return value;}
function ordinal(value){if(value===undefined)return 0;if(typeof value!=='string'||! /^(0|[1-9][0-9]{0,2})$/.test(value)||Number(value)>100)throw invalid();return Number(value);}
/** Only the server-derived session hash selects tenant and owner. */
export class WorkspaceContent {
 constructor(database){this.database=database;}
 async query(sql,session,args){
  if(typeof session!=='string'||! /^[a-f0-9]{64}$/.test(session))throw new HttpError(401,'authentication_required');
  try{return(await this.database.query(sql,[session,...args])).rows[0]?.result;}
  catch(error){
   const known={'42501':[409,'workspace_session_changed'],P0002:[404,'conversation_unavailable'],
    '53300':[429,'conversation_limit'],'22023':[400,'invalid_workspace_content'],'22P02':[400,'invalid_workspace_content']}[error.code];
   if(known)throw new HttpError(...known);throw error;
  }
 }
 list(session,after){return this.query('SELECT genie_list_conversations($1,$2) result',session,[after===undefined?null:recordId(after)]);}
 get(session,id,after){return this.query('SELECT genie_get_conversation($1,$2,$3) result',session,[recordId(id),ordinal(after)]);}
 create(session,title,content){return this.query('SELECT genie_create_conversation($1,$2,$3) result',session,[clean(title,1,120),message(content)]);}
 append(session,id,content){return this.query('SELECT genie_append_conversation($1,$2,$3) result',session,[recordId(id),message(content)]);}
 search(session,q){return this.query('SELECT genie_search_workspace($1,$2) result',session,[clean(q,2,80)]);}
}
