-- Private Portal role-assignment bridge; migration grants no callers access.
CREATE FUNCTION genie_assign_role_as_actor(p_actor uuid,p_tenant uuid,p_target uuid,p_role uuid,p_assign boolean,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m record; exists_before boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||p_tenant::text,0));
 IF NOT public.genie_has_permission(p_actor,p_tenant,'workspace.roles','assign') THEN RAISE EXCEPTION 'assignment authority required' USING ERRCODE='42501'; END IF;
 IF p_assign IS NULL THEN RAISE EXCEPTION 'assignment required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.genie_roles r WHERE r.id=p_role AND r.tenant_id=p_tenant)
 THEN RAISE EXCEPTION 'role unavailable' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM public.genie_role_permissions g WHERE g.role_id=p_role AND g.tenant_id=p_tenant
   AND NOT public.genie_has_permission(p_actor,p_tenant,g.resource,g.action))
 THEN RAISE EXCEPTION 'cannot delegate unavailable authority' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.genie_memberships WHERE tenant_id=p_tenant AND user_id=p_target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'member unavailable' USING ERRCODE='P0002'; END IF;
 IF m.role='admin' THEN RAISE EXCEPTION 'built-in administrator authority is immutable here' USING ERRCODE='42501'; END IF;
 IF p_assign AND (m.status<>'active' OR NOT EXISTS(SELECT 1 FROM public.genie_users WHERE id=p_target AND enabled))
 THEN RAISE EXCEPTION 'active reviewed member required' USING ERRCODE='22023'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.genie_member_roles WHERE tenant_id=p_tenant AND user_id=p_target AND role_id=p_role) INTO exists_before;
 IF exists_before=p_assign THEN RETURN jsonb_build_object('changed',false,'version',m.version::text); END IF;
 IF p_version IS NULL OR p_version<>m.version THEN RAISE EXCEPTION 'member changed; refresh' USING ERRCODE='40001'; END IF;
 IF p_assign THEN
   IF (SELECT count(*) FROM public.genie_member_roles WHERE tenant_id=p_tenant AND user_id=p_target)>=16 THEN RAISE EXCEPTION 'assignment limit' USING ERRCODE='23514'; END IF;
   INSERT INTO public.genie_member_roles VALUES(p_tenant,p_target,p_role);
 ELSE
   DELETE FROM public.genie_member_roles WHERE tenant_id=p_tenant AND user_id=p_target AND role_id=p_role;
 END IF;
 UPDATE public.genie_memberships SET version=version+1 WHERE tenant_id=p_tenant AND user_id=p_target;
 INSERT INTO public.genie_permission_audit(tenant_id,actor_id,role_id,target_id,action,before_state,after_state)
 VALUES(p_tenant,p_actor,p_role,p_target,CASE WHEN p_assign THEN 'role_assigned' ELSE 'role_unassigned' END,
 jsonb_build_object('assigned',exists_before),jsonb_build_object('assigned',p_assign));
 RETURN jsonb_build_object('changed',true,'version',(m.version+1)::text);
END $$;
REVOKE ALL ON FUNCTION genie_assign_role_as_actor(uuid,uuid,uuid,uuid,boolean,bigint) FROM PUBLIC;
CREATE OR REPLACE FUNCTION genie_assign_role(p_session text,p_target uuid,p_role uuid,p_assign boolean,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record;
BEGIN
 SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.roles','assign',true);
 RETURN public.genie_assign_role_as_actor(a.user_id,a.tenant_id,p_target,p_role,p_assign,p_version);
END $$;

CREATE FUNCTION genie_portal_roles_preview(p_issuer text,p_actor_subject text,p_target_subject text,p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE state jsonb; available jsonb;
BEGIN
 state:=public.genie_portal_membership_preview(p_issuer,p_actor_subject,p_target_subject,p_tenant);
 IF state->>'actorId'=state->>'targetId' OR state->>'role'<>'member' OR state->>'status'<>'active'
 OR state->>'targetEnabled'<>'true' THEN RAISE EXCEPTION 'active non-administrator required' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.genie_roles WHERE tenant_id=p_tenant)>100 THEN RAISE EXCEPTION 'catalogue limit' USING ERRCODE='23514'; END IF;
 -- Native role editors take the same tenant lock. Also pin rows against direct administrative changes.
 PERFORM 1 FROM public.genie_roles WHERE tenant_id=p_tenant ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.genie_role_permissions WHERE tenant_id=p_tenant ORDER BY role_id,resource,action FOR SHARE;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'version',r.version::text,
   'grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('resource',g.resource,'action',g.action) ORDER BY g.resource,g.action),'[]')
     FROM public.genie_role_permissions g WHERE g.tenant_id=r.tenant_id AND g.role_id=r.id)) ORDER BY r.id),'[]')
 INTO available FROM public.genie_roles r WHERE r.tenant_id=p_tenant;
 RETURN state||jsonb_build_object('availableRoles',available);
END $$;
REVOKE ALL ON FUNCTION genie_portal_roles_preview(text,text,text,uuid) FROM PUBLIC;

CREATE FUNCTION genie_portal_roles_change(p_request uuid,p_issuer text,p_actor_subject text,p_target_subject text,p_tenant uuid,p_roles jsonb,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE state jsonb; final_state jsonb; selected uuid[]; prior uuid[]; r uuid; v_version bigint;
BEGIN
 state:=public.genie_portal_roles_preview(p_issuer,p_actor_subject,p_target_subject,p_tenant);
 IF p_request IS NULL OR p_expected IS NULL OR state IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'review changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.genie_portal_receipts WHERE request_id=p_request) THEN RAISE EXCEPTION 'receipt exists' USING ERRCODE='23505'; END IF;
 IF jsonb_typeof(p_roles) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'role selection required' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_roles)>16 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_roles) x WHERE jsonb_typeof(x)<>'string')
 THEN RAISE EXCEPTION 'invalid role selection' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(x::uuid ORDER BY x::uuid),'{}'::uuid[]) INTO selected FROM jsonb_array_elements_text(p_roles) x;
 IF cardinality(selected)<>(SELECT count(DISTINCT x) FROM unnest(selected) x)
 OR EXISTS(SELECT 1 FROM unnest(selected) x WHERE NOT EXISTS(SELECT 1 FROM public.genie_roles g WHERE g.id=x AND g.tenant_id=p_tenant))
 THEN RAISE EXCEPTION 'unknown or duplicate role' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(role_id ORDER BY role_id),'{}'::uuid[]) INTO prior FROM public.genie_member_roles
 WHERE tenant_id=p_tenant AND user_id=(state->>'targetId')::uuid;
 v_version:=(state->>'version')::bigint;
 -- Remove before adding, so replacing a full set does not exceed the native limit.
 FOREACH r IN ARRAY prior LOOP
   IF NOT r=ANY(selected) THEN
     PERFORM public.genie_assign_role_as_actor((state->>'actorId')::uuid,p_tenant,(state->>'targetId')::uuid,r,false,v_version);
     v_version:=v_version+1;
   END IF;
 END LOOP;
 FOREACH r IN ARRAY selected LOOP
   IF NOT r=ANY(prior) THEN
     PERFORM public.genie_assign_role_as_actor((state->>'actorId')::uuid,p_tenant,(state->>'targetId')::uuid,r,true,v_version);
     v_version:=v_version+1;
   END IF;
 END LOOP;
 final_state:=public.genie_portal_roles_preview(p_issuer,p_actor_subject,p_target_subject,p_tenant);
 INSERT INTO public.genie_portal_receipts(request_id,tenant_id,actor_id,target_id,before_state,after_state)
 VALUES(p_request,p_tenant,(state->>'actorId')::uuid,(state->>'targetId')::uuid,state,final_state);
 RETURN jsonb_build_object('requestId',p_request,'changed',prior IS DISTINCT FROM selected,'before',state,'after',final_state);
END $$;
REVOKE ALL ON FUNCTION genie_portal_roles_change(uuid,text,text,text,uuid,jsonb,jsonb) FROM PUBLIC;
