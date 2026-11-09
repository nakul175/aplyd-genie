-- Explicit second-workspace membership, without identity creation or email matching.
ALTER TABLE genie_memberships ADD COLUMN portal_enrollment_request uuid UNIQUE;
ALTER TABLE genie_membership_audit DROP CONSTRAINT genie_membership_audit_action_check;
ALTER TABLE genie_membership_audit ADD CONSTRAINT genie_membership_audit_action_check CHECK
(action IN ('invited','invitation_revoked','invitation_expired','invitation_accepted','deactivated','reactivated','role_changed','portal_enrolled'));
CREATE FUNCTION genie_portal_enrollment_preview(p_issuer text,p_actor_subject text,p_target_subject text,p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; v_target record;
BEGIN
 IF p_issuer IS NULL OR length(p_issuer) NOT BETWEEN 1 AND 300 OR p_target_subject IS NULL OR length(p_target_subject) NOT BETWEEN 1 AND 200 OR p_target_subject=p_actor_subject THEN RAISE EXCEPTION 'invalid identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||p_tenant::text,0));
 SELECT u.id,m.version membership_version,r.version reviewer_version,r.review_reference INTO a
 FROM public.genie_users u JOIN public.genie_memberships m ON m.user_id=u.id
 JOIN public.genie_tenants t ON t.id=m.tenant_id JOIN public.genie_portal_reviewers r ON r.user_id=u.id AND r.tenant_id=t.id
 WHERE u.issuer=p_issuer AND u.subject=p_actor_subject AND u.enabled AND t.id=p_tenant AND t.enabled AND m.status='active' AND m.role='admin' AND r.enabled FOR SHARE OF u,m,t,r;
 IF NOT FOUND THEN RAISE EXCEPTION 'reviewed administrator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_target FROM public.genie_users WHERE issuer=p_issuer AND subject=p_target_subject AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'existing exact identity required' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM public.genie_memberships WHERE tenant_id=p_tenant AND user_id=v_target.id) THEN RAISE EXCEPTION 'existing membership requires separate review' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.genie_membership_invites WHERE tenant_id=p_tenant AND recipient_id=v_target.id AND state='pending') THEN RAISE EXCEPTION 'pending native invitation requires reconciliation' USING ERRCODE='23505'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.genie_memberships m JOIN public.genie_tenants t ON t.id=m.tenant_id WHERE m.user_id=v_target.id AND m.status='active' AND t.enabled) THEN RAISE EXCEPTION 'existing active workspace required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('issuer',p_issuer,'actorSubject',p_actor_subject,'targetSubject',p_target_subject,'tenantId',p_tenant,'actorId',a.id,'targetId',v_target.id,'actorVersion',a.membership_version::text,'reviewerVersion',a.reviewer_version::text,'reviewReference',a.review_reference,'originRequest',v_target.portal_provision_request,'originTenant',v_target.portal_provision_tenant);
END $$;
REVOKE ALL ON FUNCTION genie_portal_enrollment_preview(text,text,text,uuid) FROM PUBLIC;
CREATE FUNCTION genie_portal_enrollment_create(p_request uuid,p_issuer text,p_actor_subject text,p_target_subject text,p_tenant uuid,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b jsonb; a jsonb;
BEGIN
 b:=public.genie_portal_enrollment_preview(p_issuer,p_actor_subject,p_target_subject,p_tenant);
 IF p_request IS NULL OR p_expected IS DISTINCT FROM b THEN RAISE EXCEPTION 'review changed' USING ERRCODE='40001'; END IF;
 INSERT INTO public.genie_memberships(user_id,tenant_id,status,role,review_reference,portal_enrollment_request)
 VALUES((b->>'targetId')::uuid,p_tenant,'active','member','Portal workspace enrollment '||p_request::text,p_request);
 a:=jsonb_build_object('requestId',p_request,'targetId',b->'targetId','issuer',p_issuer,'subject',p_target_subject,'tenantId',p_tenant,'status','active','role','member','version','1');
 INSERT INTO public.genie_portal_receipts(request_id,tenant_id,actor_id,target_id,before_state,after_state) VALUES(p_request,p_tenant,(b->>'actorId')::uuid,(b->>'targetId')::uuid,b,a);
 INSERT INTO public.genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state) VALUES(p_tenant,(b->>'actorId')::uuid,(b->>'targetId')::uuid,'portal_enrolled',b,a);
 RETURN jsonb_build_object('before',b,'after',a);
END $$;
REVOKE ALL ON FUNCTION genie_portal_enrollment_create(uuid,text,text,text,uuid,jsonb) FROM PUBLIC;
