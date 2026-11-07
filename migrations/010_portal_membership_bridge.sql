-- Default-deny service boundary. Installing this migration grants no caller
-- access and approves no reviewer. A separate reviewed, per-tenant DB grant is
-- required. The ordinary application never receives these EXECUTE privileges.
CREATE TABLE genie_portal_reviewers (
  tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
  user_id uuid NOT NULL REFERENCES genie_users(id),
  enabled boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  review_reference text NOT NULL CHECK(length(trim(review_reference)) BETWEEN 1 AND 200),
  PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE genie_portal_receipts (
  request_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
  actor_id uuid NOT NULL REFERENCES genie_users(id),
  target_id uuid NOT NULL REFERENCES genie_users(id),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE genie_portal_reviewers,genie_portal_receipts FROM PUBLIC;

CREATE FUNCTION genie_portal_reviewer_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version:=OLD.version+1;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION genie_portal_reviewer_revision() FROM PUBLIC;
CREATE TRIGGER genie_portal_reviewer_changed BEFORE UPDATE ON genie_portal_reviewers
  FOR EACH ROW EXECUTE FUNCTION genie_portal_reviewer_revision();

-- Both the native UI and the Portal use exactly the native membership policy.
-- This private helper has no public or runtime-role EXECUTE grant.
CREATE FUNCTION genie_change_member_as_actor(p_actor uuid,p_tenant uuid,p_builtin_role text,
  p_target uuid,p_status text,p_role text,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b record; v_action text; v_count integer;
BEGIN
  IF p_status NOT IN ('active','disabled') OR p_role NOT IN ('member','admin') OR p_status IS NULL OR p_role IS NULL
    THEN RAISE EXCEPTION 'invalid membership change' USING ERRCODE='22023'; END IF;
  SELECT m.status,m.role,m.version INTO b FROM public.genie_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=p_target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found' USING ERRCODE='P0002'; END IF;
  IF p_builtin_role<>'admin' AND (b.role='admin' OR p_role='admin') THEN RAISE EXCEPTION 'built-in administrator authority required' USING ERRCODE='42501'; END IF;
  IF b.status=p_status AND b.role=p_role THEN RETURN jsonb_build_object('changed',false); END IF;
  IF p_version IS NULL OR p_version<>b.version THEN RAISE EXCEPTION 'membership changed; refresh before retry' USING ERRCODE='40001'; END IF;
  IF p_status='active' AND NOT EXISTS(SELECT 1 FROM public.genie_users u WHERE u.id=p_target AND u.enabled)
    THEN RAISE EXCEPTION 'reviewed identity required' USING ERRCODE='22023'; END IF;
  IF b.status='active' AND b.role='admin' AND (p_status<>'active' OR p_role<>'admin') THEN
    SELECT count(*) INTO v_count FROM public.genie_memberships m JOIN public.genie_users u ON u.id=m.user_id
      WHERE m.tenant_id=p_tenant AND m.status='active' AND m.role='admin' AND u.enabled;
    IF v_count<=1 THEN RAISE EXCEPTION 'last administrator must remain active' USING ERRCODE='23514'; END IF;
  END IF;
  UPDATE public.genie_memberships SET status=p_status,role=p_role,version=version+1 WHERE tenant_id=p_tenant AND user_id=p_target;
  IF p_status='disabled' OR b.role<>p_role THEN
    DELETE FROM public.genie_sessions WHERE tenant_id=p_tenant AND user_id=p_target;
  END IF;
  v_action:=CASE WHEN p_status='disabled' AND b.status<>'disabled' THEN 'deactivated'
    WHEN p_status='active' AND b.status<>'active' THEN 'reactivated' ELSE 'role_changed' END;
  INSERT INTO public.genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
    VALUES(p_tenant,p_actor,p_target,v_action,jsonb_build_object('status',b.status,'role',b.role),jsonb_build_object('status',p_status,'role',p_role));
  RETURN jsonb_build_object('changed',true,'status',p_status,'role',p_role);
END $$;
REVOKE ALL ON FUNCTION genie_change_member_as_actor(uuid,uuid,text,uuid,text,text,bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION genie_change_member(p_session text,p_target uuid,p_status text,p_role text,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.members','manage',true);
  RETURN public.genie_change_member_as_actor(a.user_id,a.tenant_id,a.builtin_role,p_target,p_status,p_role,p_version);
END $$;

CREATE FUNCTION genie_portal_membership_preview(p_issuer text,p_actor_subject text,p_target_subject text,p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; b record; inherited jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||p_tenant::text,0));
  SELECT u.id,m.version membership_version,r.version reviewer_version,r.review_reference INTO a
    FROM public.genie_users u JOIN public.genie_memberships m ON m.user_id=u.id
    JOIN public.genie_tenants t ON t.id=m.tenant_id
    JOIN public.genie_portal_reviewers r ON r.user_id=u.id AND r.tenant_id=t.id
    WHERE u.issuer=p_issuer AND u.subject=p_actor_subject AND u.enabled AND t.id=p_tenant AND t.enabled
      AND m.status='active' AND m.role='admin' AND r.enabled FOR SHARE OF u,m,t,r;
  IF NOT FOUND THEN RAISE EXCEPTION 'reviewed native administrator required' USING ERRCODE='42501'; END IF;
  SELECT u.id,u.enabled,m.status,m.role,m.version INTO b FROM public.genie_users u
    JOIN public.genie_memberships m ON m.user_id=u.id
    WHERE u.issuer=p_issuer AND u.subject=p_target_subject AND m.tenant_id=p_tenant FOR SHARE OF u,m;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact native membership required' USING ERRCODE='P0002'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'version',r.version::text,
    'grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('resource',g.resource,'action',g.action)
      ORDER BY g.resource,g.action),'[]') FROM public.genie_role_permissions g WHERE g.tenant_id=r.tenant_id AND g.role_id=r.id)) ORDER BY r.id),'[]')
    INTO inherited FROM public.genie_member_roles mr JOIN public.genie_roles r ON r.id=mr.role_id AND r.tenant_id=mr.tenant_id
    WHERE mr.user_id=b.id AND mr.tenant_id=p_tenant;
  RETURN jsonb_build_object('tenantId',p_tenant,'actorId',a.id,'actorVersion',a.membership_version::text,
    'reviewerVersion',a.reviewer_version::text,'reviewReference',a.review_reference,
    'targetId',b.id,'targetEnabled',b.enabled,'status',b.status,'role',b.role,'version',b.version::text,
    'customRoles',inherited,'catalogue',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.resource,c.action),'[]')
      FROM public.genie_permission_catalog c));
END $$;
REVOKE ALL ON FUNCTION genie_portal_membership_preview(text,text,text,uuid) FROM PUBLIC;

CREATE FUNCTION genie_portal_membership_change(p_request uuid,p_issuer text,p_actor_subject text,
  p_target_subject text,p_tenant uuid,p_status text,p_role text,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE state jsonb; result jsonb; final_state jsonb;
BEGIN
  state:=public.genie_portal_membership_preview(p_issuer,p_actor_subject,p_target_subject,p_tenant);
  IF p_request IS NULL OR p_expected IS NULL OR state IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'review changed' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM public.genie_portal_receipts WHERE request_id=p_request) THEN
    RAISE EXCEPTION 'receipt already exists; reconcile before retry' USING ERRCODE='23505'; END IF;
  result:=public.genie_change_member_as_actor((state->>'actorId')::uuid,p_tenant,'admin',
    (state->>'targetId')::uuid,p_status,p_role,(state->>'version')::bigint);
  -- Self-demotion may remove preview authority; read only the committed target.
  SELECT jsonb_build_object('status',m.status,'role',m.role,'version',m.version::text) INTO final_state
    FROM public.genie_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=(state->>'targetId')::uuid;
  IF final_state->>'status' IS DISTINCT FROM p_status OR final_state->>'role' IS DISTINCT FROM p_role THEN
    RAISE EXCEPTION 'membership readback mismatch' USING ERRCODE='40001'; END IF;
  INSERT INTO public.genie_portal_receipts(request_id,tenant_id,actor_id,target_id,before_state,after_state)
    VALUES(p_request,p_tenant,(state->>'actorId')::uuid,(state->>'targetId')::uuid,state,final_state);
  RETURN jsonb_build_object('requestId',p_request,'changed',result->'changed','membership',final_state);
END $$;
REVOKE ALL ON FUNCTION genie_portal_membership_change(uuid,text,text,text,uuid,text,text,jsonb) FROM PUBLIC;
