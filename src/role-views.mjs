import {escapeHtml as esc} from './member-views.mjs';
import {allows,permissionLabels} from './capabilities.mjs';
const hidden=(name,value)=>`<input type="hidden" name="${name}" value="${esc(value)}">`;
const label=g=>permissionLabels[g.resource+':'+g.action]??`${g.resource}: ${g.action}`;
function grantsList(grants){return grants.length?'<ul>'+grants.map(g=>`<li>${esc(label(g))}</li>`).join('')+'</ul>':'<p>No permissions.</p>';}
function grantFields(catalog,selected,editable){
 return '<fieldset><legend>Permissions</legend>'+catalog.map(g=>{
  const checked=selected.some(x=>x.resource===g.resource&&x.action===g.action);
  return `<label><input type="checkbox" name="grants" value="${esc(g.resource+':'+g.action)}"${checked?' checked':''}${editable&&g.available?'':' disabled'}> ${esc(label(g))}</label><br>`;
 }).join('')+'</fieldset>';
}
export function roleView(kind,page,{capabilities=[],search=''}){
 const titles={roles:'Workspace roles',assignments:'Role assignments',audit:'Role activity'};
 const links=[];
 if(allows(capabilities,'workspace.roles','read'))links.push('<a href="/workspace/roles?view=roles">Workspace roles</a>');
 if(allows(capabilities,'workspace.roles','assign')&&allows(capabilities,'workspace.members','read'))links.push('<a href="/workspace/roles?view=assignments">Role assignments</a>');
 if(allows(capabilities,'workspace.audit','read'))links.push('<a href="/workspace/roles?view=audit">Role activity</a>');
 if(allows(capabilities,'workspace.members','read'))links.push('<a href="/workspace/members">Workspace members</a>');
 let body=`<h1>${titles[kind]}</h1><nav>${links.join(' · ')}</nav><p><a href="/workspace">Back to workspace</a></p>`;
 if(kind!=='audit')body+=`<form method="get" action="/workspace/roles">${hidden('view',kind)}<label>Find ${kind==='roles'?'a role':'a person'} <input name="search" maxlength="80" value="${esc(search)}"></label><button>Search</button></form>`;
 if(kind==='roles'&&allows(capabilities,'workspace.roles','manage'))body+='<section><h2>Create role</h2><form method="post" action="/workspace/roles/save">'+
  '<label>Role name <input name="name" maxlength="80" required></label>'+grantFields(page.catalog,[],true)+'<p>You can grant only permissions you currently hold.</p><button>Create role</button></form></section>';
 if(!page.items.length)body+='<p>No matching records.</p>';
 for(const item of page.items){
  if(kind==='roles')body+=`<section><h2>${esc(item.name)}</h2>`+(item.canManage?'<form method="post" action="/workspace/roles/save">'+
   hidden('roleId',item.id)+hidden('version',item.version)+`<label>Role name <input name="name" maxlength="80" value="${esc(item.name)}" required></label>`+
   grantFields(page.catalog,item.grants,true)+'<button>Save role</button></form>':grantsList(item.grants))+'</section>';
  if(kind==='assignments'){
   body+=`<section><h2>${esc(item.displayName)}</h2><p>${item.status==='active'?'Active':'Deactivated'} · Roles: ${esc(item.roles.map(r=>r.name).join(', ')||'None')}</p>`;
   if(page.availableRoles.length)body+='<form method="post" action="/workspace/roles/assign">'+hidden('target',item.userId)+hidden('version',item.version)+
    '<label>Role <select name="roleId" required><option value="" selected disabled>Select a role</option>'+page.availableRoles.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')+'</select></label> '+
    '<label>Change <select name="assigned">'+(item.status==='active'?'<option value="true">Assign</option>':'')+'<option value="false">Remove</option></select></label> <button>Save assignment</button></form>';
   body+='</section>';
  }
  if(kind==='audit')body+=`<section><h2>${esc({role_created:'Role created',role_updated:'Role updated',role_assigned:'Role assigned',role_unassigned:'Role removed'}[item.action])}</h2><p>${esc(item.actor)} → ${esc(item.target??item.roleName)} · ${esc(item.createdAt)}</p>`+
   '<h3>Before</h3>'+(item.before.grants?grantsList(item.before.grants):`<p>${item.before.assigned?'Assigned':'Not assigned'}</p>`)+
   '<h3>After</h3>'+(item.after.grants?grantsList(item.after.grants):`<p>${item.after.assigned?'Assigned':'Not assigned'}</p>` )+'</section>';
 }
 if(page.nextCursor)body+=`<p><a href="/workspace/roles?view=${kind}&amp;after=${encodeURIComponent(page.nextCursor)}&amp;search=${encodeURIComponent(search)}">Next page</a></p>`;
 return body;
}
