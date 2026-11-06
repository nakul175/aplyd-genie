export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option=(value,label,current)=>`<option value="${escapeHtml(value)}"${value===current?' selected':''}>${escapeHtml(label)}</option>`;
const hidden=(name,value)=>`<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
const roleSelect=current=>`<select name="role" aria-label="Role">${option('member','Member',current)}${option('admin','Administrator',current)}</select>`;
const form=(action,body)=>`<form method="post" action="${action}">${body}</form>`;
const names={members:'Workspace members',people:'Invite people',invitations:'Pending invitations',audit:'Membership activity'};
const actions={invited:'Invitation created',invitation_revoked:'Invitation revoked',invitation_expired:'Invitation expired',invitation_accepted:'Invitation accepted',deactivated:'Member deactivated',reactivated:'Member reactivated',role_changed:'Role changed'};
export function memberView(kind,page,{search=''}) {
  const navigation=Object.entries(names).map(([key,name])=>`<a href="/workspace/members?view=${key}">${name}</a>`).join(' · ');
  let body=`<h1>${names[kind]}</h1><nav>${navigation}</nav><p><a href="/workspace">Back to workspace</a></p>`;
  if(kind!=='audit') body+=`<form method="get" action="/workspace/members">${hidden('view',kind)}<label>Find a person <input name="search" maxlength="80" value="${escapeHtml(search)}"></label><button>Search</button></form>`;
  if(!page.items.length)body+='<p>No matching records.</p>';
  for(const item of page.items) {
    if(kind==='members')body+=`<section><h2>${escapeHtml(item.displayName)}</h2>`+form('/workspace/members/change',
      hidden('target',item.userId)+hidden('version',item.version)+`<label>Status <select name="status">${option('active','Active',item.status)}${option('disabled','Deactivated',item.status)}</select></label> <label>Role ${roleSelect(item.role)}</label> <button>Save membership</button>`)+`</section>`;
    if(kind==='people')body+=`<section><h2>${escapeHtml(item.displayName)}</h2>`+form('/workspace/members/invite',
      hidden('target',item.userId)+`<label>Role ${roleSelect('member')}</label> <button>Create invitation</button>`)+`</section>`;
    if(kind==='invitations')body+=`<section><h2>${escapeHtml(item.displayName)}</h2><p>${item.role==='admin'?'Administrator':'Member'} invitation · expires ${escapeHtml(item.expiresAt)}</p>`+
      form('/workspace/members/revoke',hidden('invitationId',item.id)+'<button>Revoke invitation</button>')+'</section>';
    if(kind==='audit')body+=`<section><h2>${escapeHtml(actions[item.action]??'Membership change')}</h2><p>${escapeHtml(item.actor)} → ${escapeHtml(item.target)} · ${escapeHtml(item.createdAt)}</p>`+
      `<p>Before: ${escapeHtml(item.before.status??item.before.state??'No membership')} ${escapeHtml(item.before.role??'')}<br>After: ${escapeHtml(item.after.status??item.after.state??'')} ${escapeHtml(item.after.role??'')}</p></section>`;
  }
  if(page.nextCursor)body+=`<p><a href="/workspace/members?view=${kind}&amp;after=${encodeURIComponent(page.nextCursor)}&amp;search=${encodeURIComponent(search)}">Next page</a></p>`;
  if(kind==='people')body+='<p>Only accounts reviewed for this workspace appear here. Ask your Accounts administrator to review a new account before inviting it.</p>';
  return body;
}
export function invitationCreated(origin,invitation) {
  return `<h1>Invitation created</h1><p>Share this one-time link with the invited person. It expires in 24 hours. This page is the only place the link is shown.</p><label>Invitation link <input readonly aria-label="Invitation link" value="${escapeHtml(origin+'/invitations/'+invitation.token)}"></label><p><a href="/workspace/members?view=invitations">View pending invitations</a></p>`;
}
