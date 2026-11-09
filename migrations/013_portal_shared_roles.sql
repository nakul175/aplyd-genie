-- Private Portal shared-role bridge; no default caller EXECUTE grants.
CREATE FUNCTION genie_save_role_as_actor(p_actor uuid,p_tenant uuid,p_role uuid,p_name text,p_grants jsonb,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old record; v_grants jsonb; v_before jsonb; v_id uuid; v_version bigint; v_before_name text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||p_tenant::text,0));
 IF NOT public.genie_has_permission(p_actor,p_tenant,'workspace.roles','manage') THEN RAISE EXCEPTION 'role authority required' USING ERRCODE='42501'; END IF;
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
   WHERE NOT public.genie_has_permission(p_actor,p_tenant,x.resource,x.action))
 THEN RAISE EXCEPTION 'cannot delegate unavailable authority' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('resource',x.resource,'action',x.action) ORDER BY x.resource,x.action),'[]'::jsonb)
 INTO v_grants FROM jsonb_to_recordset(p_grants) AS x(resource text,action text);
 IF p_role IS NOT NULL THEN
   SELECT * INTO old FROM public.genie_roles WHERE id=p_role AND tenant_id=p_tenant FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'role unavailable' USING ERRCODE='P0002'; END IF;
   v_before_name:=old.name;
   IF EXISTS(SELECT 1 FROM public.genie_role_permissions g WHERE g.tenant_id=p_tenant AND g.role_id=p_role
     AND NOT public.genie_has_permission(p_actor,p_tenant,g.resource,g.action))
   THEN RAISE EXCEPTION 'cannot manage existing role authority' USING ERRCODE='42501'; END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('resource',g.resource,'action',g.action) ORDER BY g.resource,g.action),'[]'::jsonb)
   INTO v_before FROM public.genie_role_permissions g WHERE g.tenant_id=p_tenant AND g.role_id=p_role;
   IF old.name=p_name AND v_before=v_grants THEN RETURN jsonb_build_object('changed',false,'id',old.id,'version',old.version::text); END IF;
   IF p_version IS NULL OR p_version<>old.version THEN RAISE EXCEPTION 'role changed; refresh' USING ERRCODE='40001'; END IF;
   UPDATE public.genie_roles SET name=p_name,version=version+1 WHERE id=p_role RETURNING id,version INTO v_id,v_version;
   DELETE FROM public.genie_role_permissions WHERE role_id=p_role AND tenant_id=p_tenant;
 ELSE
   IF (SELECT count(*) FROM public.genie_roles WHERE tenant_id=p_tenant)>=64 THEN RAISE EXCEPTION 'role limit' USING ERRCODE='23514'; END IF;
   INSERT INTO public.genie_roles(tenant_id,name) VALUES(p_tenant,p_name) RETURNING id,version INTO v_id,v_version;
   v_before:='[]'::jsonb;
 END IF;
 INSERT INTO public.genie_role_permissions(tenant_id,role_id,resource,action)
 SELECT p_tenant,v_id,x.resource,x.action FROM jsonb_to_recordset(v_grants) AS x(resource text,action text);
 INSERT INTO public.genie_permission_audit(tenant_id,actor_id,role_id,action,before_state,after_state)
 VALUES(p_tenant,p_actor,v_id,CASE WHEN p_role IS NULL THEN 'role_created' ELSE 'role_updated' END,
 jsonb_build_object('name',v_before_name,'grants',v_before),jsonb_build_object('name',p_name,'grants',v_grants));
 RETURN jsonb_build_object('changed',true,'id',v_id,'version',v_version::text);
END $$;

REVOKE ALL ON FUNCTION genie_save_role_as_actor(uuid,uuid,uuid,text,jsonb,bigint) FROM PUBLIC;
CREATE OR REPLACE FUNCTION genie_save_role(p_session text,p_role uuid,p_name text,p_grants jsonb,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record;
BEGIN
 SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.roles','manage',true);
 RETURN public.genie_save_role_as_actor(a.user_id,a.tenant_id,p_role,p_name,p_grants,p_version);
END $$;

CREATE FUNCTION genie_portal_role_definition_preview(p_issuer text,p_actor_subject text,p_target_subject text,p_tenant uuid,p_role uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE state jsonb; role_state jsonb; impact jsonb;
BEGIN
 state:=public.genie_portal_roles_preview(p_issuer,p_actor_subject,p_target_subject,p_tenant);
 -- Freeze assignment-set phantoms, including ordinary direct administrative DML.
 LOCK TABLE public.genie_member_roles IN SHARE MODE;
 SELECT x INTO role_state FROM jsonb_array_elements(state->'availableRoles') x WHERE x->>'id'=p_role::text;
 IF role_state IS NULL THEN RAISE EXCEPTION 'role unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.genie_memberships m JOIN public.genie_member_roles mr ON mr.user_id=m.user_id AND mr.tenant_id=m.tenant_id
 JOIN public.genie_users u ON u.id=m.user_id WHERE mr.role_id=p_role AND mr.tenant_id=p_tenant ORDER BY u.id FOR SHARE OF m,u;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'issuer',u.issuer,'subject',u.subject,'enabled',u.enabled,
 'status',m.status,'role',m.role,'version',m.version::text) ORDER BY u.id),'[]') INTO impact
 FROM public.genie_member_roles mr JOIN public.genie_users u ON u.id=mr.user_id
 JOIN public.genie_memberships m ON m.user_id=u.id AND m.tenant_id=mr.tenant_id
 WHERE mr.tenant_id=p_tenant AND mr.role_id=p_role;
 IF jsonb_array_length(impact)>200 THEN RAISE EXCEPTION 'impact review limit' USING ERRCODE='23514'; END IF;
 RETURN state||jsonb_build_object('selectedRole',role_state,'affectedMembers',impact);
END $$;
REVOKE ALL ON FUNCTION genie_portal_role_definition_preview(text,text,text,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION genie_portal_role_definition_change(p_request uuid,p_issuer text,p_actor_subject text,p_target_subject text,p_tenant uuid,p_role uuid,p_grants jsonb,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE before_state jsonb; after_state jsonb; result jsonb;
BEGIN
 before_state:=public.genie_portal_role_definition_preview(p_issuer,p_actor_subject,p_target_subject,p_tenant,p_role);
 IF p_request IS NULL OR p_expected IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'review changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.genie_portal_receipts WHERE request_id=p_request) THEN RAISE EXCEPTION 'receipt exists' USING ERRCODE='23505'; END IF;
 result:=public.genie_save_role_as_actor((before_state->>'actorId')::uuid,p_tenant,p_role,
 before_state->'selectedRole'->>'name',p_grants,(before_state->'selectedRole'->>'version')::bigint);
 after_state:=public.genie_portal_role_definition_preview(p_issuer,p_actor_subject,p_target_subject,p_tenant,p_role);
 INSERT INTO public.genie_portal_receipts(request_id,tenant_id,actor_id,target_id,before_state,after_state)
 VALUES(p_request,p_tenant,(before_state->>'actorId')::uuid,(before_state->>'targetId')::uuid,before_state,after_state);
 RETURN jsonb_build_object('requestId',p_request,'changed',result->'changed','before',before_state,'after',after_state);
END $$;
REVOKE ALL ON FUNCTION genie_portal_role_definition_change(uuid,text,text,text,uuid,uuid,jsonb,jsonb) FROM PUBLIC;
