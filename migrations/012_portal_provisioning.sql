-- New users are permanently marked as requiring a current Portal creation proof.
-- Existing users remain unchanged. No caller gains private function privileges.
ALTER TABLE genie_users ADD COLUMN portal_provision_request uuid UNIQUE;
ALTER TABLE genie_users ADD COLUMN portal_provision_tenant uuid REFERENCES genie_tenants(id);
ALTER TABLE genie_users ADD CONSTRAINT genie_provision_pair CHECK
 ((portal_provision_request IS NULL)=(portal_provision_tenant IS NULL));

CREATE FUNCTION genie_portal_provision_preview(p_issuer text,p_actor_subject text,p_target_subject text,p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record;
BEGIN
 IF p_issuer IS NULL OR length(p_issuer) NOT BETWEEN 1 AND 300 OR p_target_subject IS NULL
 OR length(p_target_subject) NOT BETWEEN 1 AND 200 OR p_target_subject=p_actor_subject
 THEN RAISE EXCEPTION 'invalid identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||p_tenant::text,0));
 SELECT u.id,m.version membership_version,r.version reviewer_version,r.review_reference INTO a
 FROM public.genie_users u JOIN public.genie_memberships m ON m.user_id=u.id
 JOIN public.genie_tenants t ON t.id=m.tenant_id JOIN public.genie_portal_reviewers r ON r.user_id=u.id AND r.tenant_id=t.id
 WHERE u.issuer=p_issuer AND u.subject=p_actor_subject AND u.enabled AND t.id=p_tenant AND t.enabled
 AND m.status='active' AND m.role='admin' AND r.enabled FOR SHARE OF u,m,t,r;
 IF NOT FOUND THEN RAISE EXCEPTION 'reviewed administrator required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.genie_users WHERE issuer=p_issuer AND subject=p_target_subject)
 THEN RAISE EXCEPTION 'existing identity requires separate review' USING ERRCODE='23505'; END IF;
 RETURN jsonb_build_object('issuer',p_issuer,'actorSubject',p_actor_subject,'targetSubject',p_target_subject,
 'tenantId',p_tenant,'actorId',a.id,'actorVersion',a.membership_version::text,
 'reviewerVersion',a.reviewer_version::text,'reviewReference',a.review_reference);
END $$;
REVOKE ALL ON FUNCTION genie_portal_provision_preview(text,text,text,uuid) FROM PUBLIC;

CREATE FUNCTION genie_portal_provision_create(p_request uuid,p_issuer text,p_actor_subject text,p_target_subject text,p_tenant uuid,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE before_state jsonb; after_state jsonb;
BEGIN
 before_state:=public.genie_portal_provision_preview(p_issuer,p_actor_subject,p_target_subject,p_tenant);
 IF p_request IS NULL OR p_expected IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'review changed' USING ERRCODE='40001'; END IF;
 INSERT INTO public.genie_users(id,issuer,subject,enabled,portal_provision_request,portal_provision_tenant)
 VALUES(p_request,p_issuer,p_target_subject,true,p_request,p_tenant);
 INSERT INTO public.genie_memberships(user_id,tenant_id,status,review_reference,role)
 VALUES(p_request,p_tenant,'active','Portal creation receipt '||p_request::text,'member');
 after_state:=jsonb_build_object('requestId',p_request,'targetId',p_request,'issuer',p_issuer,
 'subject',p_target_subject,'tenantId',p_tenant,'status','active','role','member','version','1');
 INSERT INTO public.genie_portal_receipts(request_id,tenant_id,actor_id,target_id,before_state,after_state)
 VALUES(p_request,p_tenant,(before_state->>'actorId')::uuid,p_request,before_state,after_state);
 RETURN jsonb_build_object('before',before_state,'after',after_state);
END $$;
REVOKE ALL ON FUNCTION genie_portal_provision_create(uuid,text,text,text,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION genie_portal_provision_status(p_issuer text,p_subject text,p_tenant uuid,p_request uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('active',EXISTS(SELECT 1 FROM public.genie_users u
 JOIN public.genie_memberships m ON m.user_id=u.id JOIN public.genie_tenants t ON t.id=m.tenant_id
 JOIN public.genie_portal_receipts r ON r.request_id=u.portal_provision_request AND r.target_id=u.id AND r.tenant_id=t.id
 WHERE u.id=p_request AND u.portal_provision_request=p_request AND u.portal_provision_tenant=p_tenant
 AND u.issuer=p_issuer AND u.subject=p_subject AND u.enabled AND t.enabled AND t.id=p_tenant AND m.status='active'));
$$;
REVOKE ALL ON FUNCTION genie_portal_provision_status(text,text,uuid,uuid) FROM PUBLIC;
