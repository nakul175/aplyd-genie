-- Workspace switches rotate the browser token and preserve immutable tenant bindings for jobs.
ALTER TABLE genie_tenants ADD COLUMN display_name text NOT NULL DEFAULT 'Workspace'
 CHECK(length(display_name) BETWEEN 1 AND 80 AND display_name=btrim(display_name) AND display_name !~ '[[:cntrl:]]');
ALTER TABLE genie_sessions ADD COLUMN family_id uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN browser_active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX genie_one_active_browser_context ON genie_sessions(family_id) WHERE browser_active;
CREATE INDEX genie_session_family ON genie_sessions(family_id);

CREATE FUNCTION genie_switch_workspace(p_source text,p_next text,p_target uuid,p_sealed text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_origin uuid; v_user uuid; s record; v_name text;
BEGIN
 IF p_source IS NULL OR p_source !~ '^[a-f0-9]{64}$' OR p_next IS NULL OR p_next !~ '^[a-f0-9]{64}$'
 OR p_target IS NULL OR p_source=p_next OR p_sealed IS NULL OR length(p_sealed) NOT BETWEEN 40 AND 16384
 THEN RAISE EXCEPTION 'invalid workspace switch' USING ERRCODE='22023'; END IF;
 SELECT c.tenant_id,c.user_id INTO v_origin,v_user FROM public.genie_sessions c
 WHERE c.token_hash=p_source AND c.browser_active AND c.expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'workspace session changed' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.genie_memberships m JOIN public.genie_tenants t ON t.id=m.tenant_id
   WHERE m.tenant_id=p_target AND m.user_id=v_user AND m.status='active' AND t.enabled)
 THEN RAISE EXCEPTION 'workspace unavailable' USING ERRCODE='42501'; END IF;
 -- All membership and role mutations use the same tenant lock; lock both in stable order.
 PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||least(v_origin,p_target)::text,0));
 IF v_origin<>p_target THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||greatest(v_origin,p_target)::text,0));
 END IF;
 SELECT c.* INTO s FROM public.genie_sessions c JOIN public.genie_users u ON u.id=c.user_id
 JOIN public.genie_tenants t ON t.id=c.tenant_id
 JOIN public.genie_memberships m ON m.tenant_id=t.id AND m.user_id=u.id
 WHERE c.token_hash=p_source AND c.tenant_id=v_origin AND c.browser_active AND c.expires_at>now()
 AND u.enabled AND t.enabled AND m.status='active' FOR UPDATE OF c FOR SHARE OF u,t,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'workspace session changed' USING ERRCODE='40001'; END IF;
 SELECT t.display_name INTO v_name FROM public.genie_tenants t JOIN public.genie_memberships m ON m.tenant_id=t.id
 WHERE t.id=p_target AND t.enabled AND m.user_id=s.user_id AND m.status='active' FOR SHARE OF t,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'workspace unavailable' USING ERRCODE='42501'; END IF;
 IF v_origin=p_target THEN RETURN jsonb_build_object('changed',false,'tenantId',v_origin,'name',v_name); END IF;
 IF (SELECT count(*) FROM public.genie_sessions WHERE family_id=s.family_id)>=100
 THEN RAISE EXCEPTION 'workspace session rotation limit' USING ERRCODE='53300'; END IF;
 UPDATE public.genie_sessions SET browser_active=false WHERE token_hash=p_source;
 INSERT INTO public.genie_sessions(token_hash,user_id,tenant_id,sealed_upstream,expires_at,family_id)
 VALUES(p_next,s.user_id,p_target,p_sealed,s.expires_at,s.family_id);
 RETURN jsonb_build_object('changed',true,'tenantId',p_target,'name',v_name,'expiresAt',s.expires_at);
END $$;

-- Only the current browser token can sign out its family. Other devices are independent.
CREATE FUNCTION genie_sign_out_family(p_active text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_family uuid;
BEGIN
 SELECT family_id INTO v_family FROM public.genie_sessions WHERE token_hash=p_active AND browser_active FOR UPDATE;
 IF FOUND THEN DELETE FROM public.genie_sessions WHERE family_id=v_family; END IF;
END $$;
REVOKE ALL ON FUNCTION genie_switch_workspace(text,text,uuid,text),genie_sign_out_family(text) FROM PUBLIC;
