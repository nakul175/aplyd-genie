import {HttpError} from './security.mjs';
/** Fixed platform tools only. Inputs can never supply their actor, tenant or required permission. */
export function createMemberTools({permissions,memberships}){
 const tools=new Map([
  ['members.list',{resource:'workspace.members',action:'read',run:(actor,input)=>memberships.page(actor.sessionHash,'members',input.after,input.search??'')}],
  ['members.change',{resource:'workspace.members',action:'manage',run:(actor,input)=>memberships.change(actor.sessionHash,input.target,input.status,input.role,input.version)}],
 ]);
 return {async execute(name,actor,input={}){
  const tool=tools.get(name);if(!tool)throw new HttpError(404,'tool_unavailable');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'invalid_tool_input');
  await permissions.require(actor.sessionHash,tool.resource,tool.action);
  // The normal application service checks authority again inside its database operation.
  return tool.run(actor,input);
 }};
}
