import {escapeHtml as esc} from './member-views.mjs';
export function workspaceBanner(name){
 return `<header><p>Active workspace: <strong>${esc(name)}</strong> · <a href="/workspace/switch">Switch workspace</a></p></header>`;
}
export function workspaceChoices({items,nextCursor}, {active,initial=false}={}){
 const path=initial?'/auth/workspace':'/workspace/switch';
 const heading=initial?'Choose a workspace':'Switch workspace';
 const choices=items.map(item=>`<li>${item.tenantId===active?`<strong>${esc(item.name)}</strong> · Active workspace`:
  `<form action="${path}" method="post"><input type="hidden" name="tenantId" value="${esc(item.tenantId)}"><button>${esc(item.name)}</button></form>`}</li>`).join('');
 return `<h1>${heading}</h1>${choices?`<ul>${choices}</ul>`:'<p>No available workspaces.</p>'}`+
  (nextCursor?`<p><a href="${path}?after=${encodeURIComponent(nextCursor)}">More workspaces</a></p>`:'')+
  `<p><a href="${initial?'/auth/sign-in':'/workspace'}">${initial?'Start sign-in again':'Back to workspace'}</a></p>`;
}

const threadsPath='/workspace/conversations';
const searchPath='/workspace/search';
const threadPath=id=>`${threadsPath}/${encodeURIComponent(id)}`;
const nav=`<p><a href="/workspace">Back to workspace</a> · <a href="${threadsPath}">Conversations</a> · <a href="${searchPath}">Search workspace</a></p>`;
const messageField='<label>Message <textarea name="content" maxlength="4096" required></textarea></label>';
export function conversationList(page){
 const items=page.items.map(item=>`<li><a href="${threadPath(item.id)}">${esc(item.title)}</a></li>`).join('');
 return '<h1>Your conversations</h1>'+nav+'<p>Conversations belong to the workspace where you start them.</p>'+
  (items?`<ul>${items}</ul>`:'<p>No conversations in this workspace.</p>')+
  (page.nextCursor?`<p><a href="${threadsPath}?after=${encodeURIComponent(page.nextCursor)}">More conversations</a></p>`:'')+
  `<h2>New conversation</h2><form method="post" action="${threadsPath}"><label>Title <input name="title" maxlength="120" required></label>${messageField}<button>Create conversation</button></form>`;
}
export function conversationDetail(thread){
 const messages=thread.messages.map(item=>`<li><p>${esc(item.content).replace(/\r?\n/g,'<br>')}</p></li>`).join('');
 return `<h1>${esc(thread.title)}</h1>${nav}${messages?`<ol>${messages}</ol>`:'<p>No messages on this page.</p>'}`+
  (thread.nextCursor?`<p><a href="${threadPath(thread.id)}?after=${encodeURIComponent(thread.nextCursor)}">More messages</a></p>`:'')+
  `<form method="post" action="${threadPath(thread.id)}/messages">${messageField}<button>Add message</button></form>`;
}
export function workspaceSearch(q,page){
 const kinds={member:'Member',role:'Role',conversation:'Conversation'};
 const items=page?.items.map(item=>{
  const target=item.kind==='conversation'?threadPath(item.id):
   `/workspace/${item.kind==='member'?'members':'roles'}?search=${encodeURIComponent(item.label)}`;
  return `<li><a href="${target}">${esc(item.label)}</a> · ${kinds[item.kind]}</li>`;
 }).join('');
 return '<h1>Search workspace</h1>'+nav+'<p>Search members and roles you can view, and your conversation titles.</p>'+
  `<form method="get" action="${searchPath}"><label>Search <input name="q" value="${esc(q)}" minlength="2" maxlength="80" required></label><button>Search</button></form>`+
  (page?(items?`<ul>${items}</ul>`:'<p>No matching resources.</p>'):'')+
  (page?.truncated?'<p>Showing the first 50 results. Narrow your search to see more.</p>':'');
}
