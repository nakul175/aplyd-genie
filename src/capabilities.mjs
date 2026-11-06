/** Rendering hints only; application/database operations always enforce current authority. */
export const allows=(capabilities,resource,action)=>Array.isArray(capabilities)&&capabilities.some(g=>g.resource===resource&&g.action===action);
export const permissionLabels={
 'workspace.members:read':'View workspace members','workspace.members:manage':'Manage workspace members',
 'workspace.people:read':'View reviewed people','workspace.invitations:read':'View invitations',
 'workspace.invitations:create':'Create invitations','workspace.invitations:revoke':'Revoke invitations',
 'workspace.audit:read':'View workspace activity','workspace.roles:read':'View roles',
 'workspace.roles:manage':'Manage roles','workspace.roles:assign':'Assign roles',
};
