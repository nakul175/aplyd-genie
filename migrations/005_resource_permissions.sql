-- Explicit workspace capabilities. App connectors add concrete entries only in reviewed migrations.
CREATE TABLE genie_permission_catalog (
  resource text NOT NULL,
  action text NOT NULL,
  PRIMARY KEY(resource,action)
);
INSERT INTO genie_permission_catalog VALUES
 ('workspace.members','read'),('workspace.members','manage'),('workspace.people','read'),
 ('workspace.invitations','read'),('workspace.invitations','create'),('workspace.invitations','revoke'),
 ('workspace.audit','read'),('workspace.roles','read'),('workspace.roles','manage'),('workspace.roles','assign');
CREATE TABLE genie_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80 AND name=trim(name) AND name!~'[[:cntrl:]]'),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX genie_role_name ON genie_roles(tenant_id,lower(name));
CREATE TABLE genie_role_permissions (
  tenant_id uuid NOT NULL,
  role_id uuid NOT NULL,
  resource text NOT NULL,
  action text NOT NULL,
  PRIMARY KEY(tenant_id,role_id,resource,action),
  FOREIGN KEY(tenant_id,role_id) REFERENCES genie_roles(tenant_id,id),
  FOREIGN KEY(resource,action) REFERENCES genie_permission_catalog(resource,action)
);
CREATE TABLE genie_member_roles (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,user_id,role_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES genie_memberships(tenant_id,user_id),
  FOREIGN KEY(tenant_id,role_id) REFERENCES genie_roles(tenant_id,id)
);
CREATE TABLE genie_permission_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
  actor_id uuid NOT NULL REFERENCES genie_users(id),
  role_id uuid NOT NULL REFERENCES genie_roles(id),
  target_id uuid REFERENCES genie_users(id),
  action text NOT NULL CHECK(action IN ('role_created','role_updated','role_assigned','role_unassigned')),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX genie_permission_audit_page ON genie_permission_audit(tenant_id,id DESC);

CREATE FUNCTION genie_has_permission(p_user uuid,p_tenant uuid,p_resource text,p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.genie_permission_catalog c
 JOIN public.genie_memberships m ON m.user_id=p_user AND m.tenant_id=p_tenant
 JOIN public.genie_users u ON u.id=m.user_id JOIN public.genie_tenants t ON t.id=m.tenant_id
 WHERE c.resource=p_resource AND c.action=p_action AND m.status='active' AND u.enabled AND t.enabled
 AND (m.role='admin' OR EXISTS(SELECT 1 FROM public.genie_member_roles a
   JOIN public.genie_role_permissions g ON g.tenant_id=a.tenant_id AND g.role_id=a.role_id
   WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id AND g.resource=c.resource AND g.action=c.action)))
$$;

-- Principal/tenant are derived only from the server's session hash. No public EXECUTE.
CREATE FUNCTION genie_permission_actor(p_session text,p_resource text,p_action text,p_mutation boolean DEFAULT false)
RETURNS TABLE(user_id uuid,tenant_id uuid,builtin_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT s.tenant_id INTO v_tenant FROM public.genie_sessions s WHERE s.token_hash=p_session AND s.expires_at>now();
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'permission required' USING ERRCODE='42501'; END IF;
 IF p_mutation THEN PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||v_tenant::text,0)); END IF;
 RETURN QUERY SELECT u.id,s.tenant_id,m.role FROM public.genie_sessions s
 JOIN public.genie_users u ON u.id=s.user_id JOIN public.genie_tenants t ON t.id=s.tenant_id
 JOIN public.genie_memberships m ON m.user_id=u.id AND m.tenant_id=t.id
 WHERE s.token_hash=p_session AND s.expires_at>now() AND u.enabled AND t.enabled AND m.status='active'
 AND public.genie_has_permission(u.id,t.id,p_resource,p_action) FOR SHARE OF s,u,t,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'permission required' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION genie_current_capabilities(p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; result jsonb;
BEGIN
 SELECT u.id user_id,s.tenant_id INTO a FROM public.genie_sessions s
 JOIN public.genie_users u ON u.id=s.user_id JOIN public.genie_tenants t ON t.id=s.tenant_id
 JOIN public.genie_memberships m ON m.user_id=u.id AND m.tenant_id=t.id
 WHERE s.token_hash=p_session AND s.expires_at>now() AND u.enabled AND t.enabled AND m.status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'active membership required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('resource',c.resource,'action',c.action) ORDER BY c.resource,c.action),'[]'::jsonb)
 INTO result FROM public.genie_permission_catalog c WHERE public.genie_has_permission(a.user_id,a.tenant_id,c.resource,c.action);
 RETURN result;
END $$;

CREATE FUNCTION genie_save_role(p_session text,p_role uuid,p_name text,p_grants jsonb,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; old record; v_grants jsonb; v_before jsonb; v_id uuid; v_version bigint; v_before_name text;
BEGIN
 SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.roles','manage',true);
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 80 OR p_name<>trim(p_name) OR p_name~'[[:cntrl:]]'
 OR jsonb_typeof(p_grants) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid role' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_grants)>32 THEN RAISE EXCEPTION 'too many grants' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_grants) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
   OR jsonb_typeof(x->'resource') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'action') IS DISTINCT FROM 'string'
   OR (SELECT count(*) FROM jsonb_object_keys(x))<>2)
 THEN RAISE EXCEPTION 'invalid grants' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_grants) AS x(resource text,action text)
   LEFT JOIN public.genie_permission_catalog c ON c.resource=x.resource AND c.action=x.action WHERE c.resource IS NULL)
 OR (SELECT count(*) FROM (SELECT DISTINCT x.resource,x.action FROM jsonb_to_recordset(p_grants) AS x(resource text,action text)) q)<>jsonb_array_length(p_grants)
 THEN RAISE EXCEPTION 'unknown or duplicate grants' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_grants) AS x(resource text,action text)
   WHERE NOT public.genie_has_permission(a.user_id,a.tenant_id,x.resource,x.action))
 THEN RAISE EXCEPTION 'cannot delegate unavailable authority' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('resource',x.resource,'action',x.action) ORDER BY x.resource,x.action),'[]'::jsonb)
 INTO v_grants FROM jsonb_to_recordset(p_grants) AS x(resource text,action text);
 IF p_role IS NOT NULL THEN
   SELECT * INTO old FROM public.genie_roles WHERE id=p_role AND tenant_id=a.tenant_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'role unavailable' USING ERRCODE='P0002'; END IF;
   v_before_name:=old.name;
   IF EXISTS(SELECT 1 FROM public.genie_role_permissions g WHERE g.tenant_id=a.tenant_id AND g.role_id=p_role
     AND NOT public.genie_has_permission(a.user_id,a.tenant_id,g.resource,g.action))
   THEN RAISE EXCEPTION 'cannot manage existing role authority' USING ERRCODE='42501'; END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('resource',g.resource,'action',g.action) ORDER BY g.resource,g.action),'[]'::jsonb)
   INTO v_before FROM public.genie_role_permissions g WHERE g.tenant_id=a.tenant_id AND g.role_id=p_role;
   IF old.name=p_name AND v_before=v_grants THEN RETURN jsonb_build_object('changed',false,'id',old.id,'version',old.version::text); END IF;
   IF p_version IS NULL OR p_version<>old.version THEN RAISE EXCEPTION 'role changed; refresh' USING ERRCODE='40001'; END IF;
   UPDATE public.genie_roles SET name=p_name,version=version+1 WHERE id=p_role RETURNING id,version INTO v_id,v_version;
   DELETE FROM public.genie_role_permissions WHERE role_id=p_role AND tenant_id=a.tenant_id;
 ELSE
   IF (SELECT count(*) FROM public.genie_roles WHERE tenant_id=a.tenant_id)>=64 THEN RAISE EXCEPTION 'role limit' USING ERRCODE='23514'; END IF;
   INSERT INTO public.genie_roles(tenant_id,name) VALUES(a.tenant_id,p_name) RETURNING id,version INTO v_id,v_version;
   v_before:='[]'::jsonb;
 END IF;
 INSERT INTO public.genie_role_permissions(tenant_id,role_id,resource,action)
 SELECT a.tenant_id,v_id,x.resource,x.action FROM jsonb_to_recordset(v_grants) AS x(resource text,action text);
 INSERT INTO public.genie_permission_audit(tenant_id,actor_id,role_id,action,before_state,after_state)
 VALUES(a.tenant_id,a.user_id,v_id,CASE WHEN p_role IS NULL THEN 'role_created' ELSE 'role_updated' END,
 jsonb_build_object('name',v_before_name,'grants',v_before),jsonb_build_object('name',p_name,'grants',v_grants));
 RETURN jsonb_build_object('changed',true,'id',v_id,'version',v_version::text);
END $$;

CREATE FUNCTION genie_assign_role(p_session text,p_target uuid,p_role uuid,p_assign boolean,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; m record; exists_before boolean;
BEGIN
 SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.roles','assign',true);
 IF p_assign IS NULL THEN RAISE EXCEPTION 'assignment required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.genie_roles r WHERE r.id=p_role AND r.tenant_id=a.tenant_id)
 THEN RAISE EXCEPTION 'role unavailable' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM public.genie_role_permissions g WHERE g.role_id=p_role AND g.tenant_id=a.tenant_id
   AND NOT public.genie_has_permission(a.user_id,a.tenant_id,g.resource,g.action))
 THEN RAISE EXCEPTION 'cannot delegate unavailable authority' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.genie_memberships WHERE tenant_id=a.tenant_id AND user_id=p_target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'member unavailable' USING ERRCODE='P0002'; END IF;
 IF m.role='admin' THEN RAISE EXCEPTION 'built-in administrator authority is immutable here' USING ERRCODE='42501'; END IF;
 IF p_assign AND (m.status<>'active' OR NOT EXISTS(SELECT 1 FROM public.genie_users WHERE id=p_target AND enabled))
 THEN RAISE EXCEPTION 'active reviewed member required' USING ERRCODE='22023'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.genie_member_roles WHERE tenant_id=a.tenant_id AND user_id=p_target AND role_id=p_role) INTO exists_before;
 IF exists_before=p_assign THEN RETURN jsonb_build_object('changed',false,'version',m.version::text); END IF;
 IF p_version IS NULL OR p_version<>m.version THEN RAISE EXCEPTION 'member changed; refresh' USING ERRCODE='40001'; END IF;
 IF p_assign THEN
   IF (SELECT count(*) FROM public.genie_member_roles WHERE tenant_id=a.tenant_id AND user_id=p_target)>=16 THEN RAISE EXCEPTION 'assignment limit' USING ERRCODE='23514'; END IF;
   INSERT INTO public.genie_member_roles VALUES(a.tenant_id,p_target,p_role);
 ELSE
   DELETE FROM public.genie_member_roles WHERE tenant_id=a.tenant_id AND user_id=p_target AND role_id=p_role;
 END IF;
 UPDATE public.genie_memberships SET version=version+1 WHERE tenant_id=a.tenant_id AND user_id=p_target;
 INSERT INTO public.genie_permission_audit(tenant_id,actor_id,role_id,target_id,action,before_state,after_state)
 VALUES(a.tenant_id,a.user_id,p_role,p_target,CASE WHEN p_assign THEN 'role_assigned' ELSE 'role_unassigned' END,
 jsonb_build_object('assigned',exists_before),jsonb_build_object('assigned',p_assign));
 RETURN jsonb_build_object('changed',true,'version',(m.version+1)::text);
END $$;

REVOKE ALL ON TABLE genie_permission_catalog,genie_roles,genie_role_permissions,genie_member_roles,genie_permission_audit FROM PUBLIC;
REVOKE ALL ON FUNCTION genie_has_permission(uuid,uuid,text,text),genie_permission_actor(text,text,text,boolean),
 genie_current_capabilities(text),genie_save_role(text,uuid,text,jsonb,bigint),genie_assign_role(text,uuid,uuid,boolean,bigint) FROM PUBLIC;

CREATE FUNCTION genie_roles_page(p_session text,p_kind text,p_after text DEFAULT NULL,p_search text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; result jsonb; extras jsonb;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('roles','assignments','audit') OR length(p_search)>80 OR length(p_after)>64
   OR (p_kind='roles' AND p_after IS NOT NULL) THEN RAISE EXCEPTION 'invalid policy page' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.genie_permission_actor(p_session,
   CASE p_kind WHEN 'audit' THEN 'workspace.audit' ELSE 'workspace.roles' END,
   CASE p_kind WHEN 'assignments' THEN 'assign' ELSE 'read' END,false);
 IF p_kind='roles' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'version',r.version::text,
   'grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('resource',g.resource,'action',g.action) ORDER BY g.resource,g.action),'[]'::jsonb)
     FROM public.genie_role_permissions g WHERE g.tenant_id=r.tenant_id AND g.role_id=r.id),
   'canManage',public.genie_has_permission(a.user_id,a.tenant_id,'workspace.roles','manage') AND NOT EXISTS(
     SELECT 1 FROM public.genie_role_permissions g WHERE g.role_id=r.id AND g.tenant_id=a.tenant_id
     AND NOT public.genie_has_permission(a.user_id,a.tenant_id,g.resource,g.action)),
   'canAssign',public.genie_has_permission(a.user_id,a.tenant_id,'workspace.roles','assign') AND NOT EXISTS(
     SELECT 1 FROM public.genie_role_permissions g WHERE g.role_id=r.id AND g.tenant_id=a.tenant_id
     AND NOT public.genie_has_permission(a.user_id,a.tenant_id,g.resource,g.action))) ORDER BY lower(r.name),r.id),'[]'::jsonb)
   INTO result FROM public.genie_roles r WHERE r.tenant_id=a.tenant_id AND position(lower(p_search) IN lower(r.name))>0;
  SELECT coalesce(jsonb_agg(jsonb_build_object('resource',c.resource,'action',c.action,
    'available',public.genie_has_permission(a.user_id,a.tenant_id,c.resource,c.action)) ORDER BY c.resource,c.action),'[]'::jsonb)
   INTO extras FROM public.genie_permission_catalog c;
  RETURN jsonb_build_object('items',result,'catalog',extras,'nextCursor',NULL);
 ELSIF p_kind='assignments' THEN
  PERFORM public.genie_permission_actor(p_session,'workspace.members','read',false);
  WITH page AS (
   SELECT m.user_id::text cursor,jsonb_build_object('userId',m.user_id,'displayName',coalesce(p.display_name,'Workspace member'),
    'status',m.status,'version',m.version::text,'roles',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) ORDER BY lower(r.name),r.id),'[]'::jsonb)
     FROM public.genie_member_roles ar JOIN public.genie_roles r ON r.tenant_id=ar.tenant_id AND r.id=ar.role_id
     WHERE ar.tenant_id=m.tenant_id AND ar.user_id=m.user_id)) item
   FROM public.genie_memberships m LEFT JOIN public.genie_workspace_people p ON p.tenant_id=m.tenant_id AND p.user_id=m.user_id
   WHERE m.tenant_id=a.tenant_id AND m.role='member' AND (p_after IS NULL OR m.user_id>p_after::uuid)
    AND position(lower(p_search) IN lower(coalesce(p.display_name,'Workspace member')))>0
   ORDER BY m.user_id LIMIT 51
  ), shown AS (SELECT * FROM page ORDER BY cursor LIMIT 50)
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(item ORDER BY cursor),'[]'::jsonb),
   'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT max(cursor) FROM shown) END) INTO result FROM shown;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) ORDER BY lower(r.name),r.id),'[]'::jsonb)
   INTO extras FROM public.genie_roles r WHERE r.tenant_id=a.tenant_id AND NOT EXISTS(
    SELECT 1 FROM public.genie_role_permissions g WHERE g.role_id=r.id AND g.tenant_id=a.tenant_id
    AND NOT public.genie_has_permission(a.user_id,a.tenant_id,g.resource,g.action));
  RETURN result||jsonb_build_object('availableRoles',extras);
 ELSE
  WITH page AS (
   SELECT e.id cursor,jsonb_build_object('id',e.id::text,'action',e.action,'roleName',r.name,
    'actor',coalesce(actor.display_name,'Workspace member'),'target',target.display_name,
    'before',e.before_state,'after',e.after_state,'createdAt',e.created_at) item
   FROM public.genie_permission_audit e JOIN public.genie_roles r ON r.tenant_id=e.tenant_id AND r.id=e.role_id
   LEFT JOIN public.genie_workspace_people actor ON actor.tenant_id=e.tenant_id AND actor.user_id=e.actor_id
   LEFT JOIN public.genie_workspace_people target ON target.tenant_id=e.tenant_id AND target.user_id=e.target_id
   WHERE e.tenant_id=a.tenant_id AND (p_after IS NULL OR e.id<p_after::bigint) ORDER BY e.id DESC LIMIT 51
  ), shown AS (SELECT * FROM page ORDER BY cursor DESC LIMIT 50)
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(item ORDER BY cursor DESC),'[]'::jsonb),
   'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT min(cursor)::text FROM shown) END) INTO result FROM shown;
  RETURN result;
 END IF;
END $$;
REVOKE ALL ON FUNCTION genie_roles_page(text,text,text,text) FROM PUBLIC;
