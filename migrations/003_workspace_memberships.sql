ALTER TABLE genie_memberships ADD COLUMN role text NOT NULL DEFAULT 'member'
  CHECK (role IN ('member','admin'));
ALTER TABLE genie_memberships ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0);

-- Reviewed identity visibility is explicitly scoped; it does not grant membership.
CREATE TABLE genie_workspace_people (
  tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
  user_id uuid NOT NULL REFERENCES genie_users(id),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  review_reference text NOT NULL CHECK (length(trim(review_reference)) > 0),
  PRIMARY KEY (tenant_id,user_id)
);
CREATE TABLE genie_membership_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
  recipient_id uuid NOT NULL REFERENCES genie_users(id),
  created_by uuid NOT NULL REFERENCES genie_users(id),
  role text NOT NULL CHECK (role IN ('member','admin')),
  token_hash char(64) NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','revoked','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX genie_one_pending_invite ON genie_membership_invites(tenant_id,recipient_id) WHERE state='pending';
CREATE TABLE genie_membership_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
  actor_id uuid NOT NULL REFERENCES genie_users(id),
  target_id uuid NOT NULL REFERENCES genie_users(id),
  action text NOT NULL CHECK (action IN ('invited','invitation_revoked','invitation_expired','invitation_accepted','deactivated','reactivated','role_changed')),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX genie_membership_audit_page ON genie_membership_audit(tenant_id,id DESC);

-- These entry points are the runtime's only membership write authority. Identity,
-- directory and audit tables remain inaccessible for direct runtime mutations.
CREATE FUNCTION genie_admin_actor(p_session text)
RETURNS TABLE(user_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant FROM public.genie_sessions s WHERE s.token_hash=p_session AND s.expires_at>now();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'active administrator required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||v_tenant::text,0));
  RETURN QUERY SELECT u.id,s.tenant_id FROM public.genie_sessions s
    JOIN public.genie_users u ON u.id=s.user_id
    JOIN public.genie_tenants t ON t.id=s.tenant_id
    JOIN public.genie_memberships m ON m.user_id=u.id AND m.tenant_id=t.id
    WHERE s.token_hash=p_session AND s.expires_at>now() AND u.enabled AND t.enabled
      AND m.status='active' AND m.role='admin' FOR SHARE OF s,u,t,m;
  IF NOT FOUND THEN RAISE EXCEPTION 'active administrator required' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION genie_change_member(p_session text,p_target uuid,p_status text,p_role text,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; b record; v_action text; v_count integer;
BEGIN
  SELECT * INTO a FROM public.genie_admin_actor(p_session);
  IF p_status NOT IN ('active','disabled') OR p_role NOT IN ('member','admin') OR p_status IS NULL OR p_role IS NULL
    THEN RAISE EXCEPTION 'invalid membership change' USING ERRCODE='22023'; END IF;
  SELECT m.status,m.role,m.version INTO b FROM public.genie_memberships m WHERE m.tenant_id=a.tenant_id AND m.user_id=p_target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found' USING ERRCODE='P0002'; END IF;
  IF b.status=p_status AND b.role=p_role THEN RETURN jsonb_build_object('changed',false); END IF;
  IF p_version IS NULL OR p_version<>b.version THEN RAISE EXCEPTION 'membership changed; refresh before retry' USING ERRCODE='40001'; END IF;
  IF p_status='active' AND NOT EXISTS(SELECT 1 FROM public.genie_users u WHERE u.id=p_target AND u.enabled)
    THEN RAISE EXCEPTION 'reviewed identity required' USING ERRCODE='22023'; END IF;
  IF b.status='active' AND b.role='admin' AND (p_status<>'active' OR p_role<>'admin') THEN
    SELECT count(*) INTO v_count FROM public.genie_memberships m JOIN public.genie_users u ON u.id=m.user_id
      WHERE m.tenant_id=a.tenant_id AND m.status='active' AND m.role='admin' AND u.enabled;
    IF v_count<=1 THEN RAISE EXCEPTION 'last administrator must remain active' USING ERRCODE='23514'; END IF;
  END IF;
  UPDATE public.genie_memberships SET status=p_status,role=p_role,version=version+1 WHERE tenant_id=a.tenant_id AND user_id=p_target;
  -- Revalidation also checks live membership, but deletion prevents later revival.
  IF p_status='disabled' OR b.role<>p_role THEN
    DELETE FROM public.genie_sessions WHERE tenant_id=a.tenant_id AND user_id=p_target;
  END IF;
  v_action:=CASE WHEN p_status='disabled' AND b.status<>'disabled' THEN 'deactivated'
    WHEN p_status='active' AND b.status<>'active' THEN 'reactivated' ELSE 'role_changed' END;
  INSERT INTO public.genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
    VALUES(a.tenant_id,a.user_id,p_target,v_action,jsonb_build_object('status',b.status,'role',b.role),jsonb_build_object('status',p_status,'role',p_role));
  RETURN jsonb_build_object('changed',true,'status',p_status,'role',p_role);
END $$;

CREATE FUNCTION genie_create_invite(p_session text,p_recipient uuid,p_role text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; i record; expired record;
BEGIN
  SELECT * INTO a FROM public.genie_admin_actor(p_session);
  IF p_role IS NULL OR p_role NOT IN ('member','admin') OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'invalid invitation' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.genie_workspace_people p JOIN public.genie_users u ON u.id=p.user_id
      JOIN public.genie_users actor ON actor.id=a.user_id
      WHERE p.tenant_id=a.tenant_id AND p.user_id=p_recipient AND u.enabled AND u.issuer=actor.issuer)
    THEN RAISE EXCEPTION 'reviewed recipient not found' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.genie_memberships m WHERE m.tenant_id=a.tenant_id AND m.user_id=p_recipient AND m.status='active')
    THEN RAISE EXCEPTION 'already a member' USING ERRCODE='23505'; END IF;
  FOR expired IN UPDATE public.genie_membership_invites SET state='expired'
    WHERE tenant_id=a.tenant_id AND recipient_id=p_recipient AND state='pending' AND expires_at<=now() RETURNING id
  LOOP
    INSERT INTO public.genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
      VALUES(a.tenant_id,a.user_id,p_recipient,'invitation_expired',jsonb_build_object('state','pending','invitationId',expired.id),jsonb_build_object('state','expired'));
  END LOOP;
  INSERT INTO public.genie_membership_invites(tenant_id,recipient_id,created_by,role,token_hash,expires_at)
    VALUES(a.tenant_id,p_recipient,a.user_id,p_role,p_hash,now()+interval '24 hours') RETURNING id,expires_at INTO i;
  INSERT INTO public.genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
    VALUES(a.tenant_id,a.user_id,p_recipient,'invited','{}',jsonb_build_object('invitationId',i.id,'role',p_role,'state','pending'));
  RETURN jsonb_build_object('id',i.id,'expiresAt',i.expires_at);
END $$;

CREATE FUNCTION genie_revoke_invite(p_session text,p_invitation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; i record;
BEGIN
  SELECT * INTO a FROM public.genie_admin_actor(p_session);
  SELECT * INTO i FROM public.genie_membership_invites WHERE id=p_invitation AND tenant_id=a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation not found' USING ERRCODE='P0002'; END IF;
  IF i.state<>'pending' THEN RETURN jsonb_build_object('changed',false); END IF;
  UPDATE public.genie_membership_invites SET state='revoked' WHERE id=i.id;
  INSERT INTO public.genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
    VALUES(a.tenant_id,a.user_id,i.recipient_id,'invitation_revoked',jsonb_build_object('invitationId',i.id,'state','pending'),jsonb_build_object('state','revoked'));
  RETURN jsonb_build_object('changed',true);
END $$;

-- A matching token alone never proves the invited identity. The caller must first
-- verify Accounts OIDC and fresh session proof for the returned exact native user.
CREATE FUNCTION genie_invite_recipient(p_hash text,p_issuer text,p_subject text)
RETURNS TABLE(user_id uuid,tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT u.id,i.tenant_id FROM public.genie_membership_invites i
    JOIN public.genie_users u ON u.id=i.recipient_id JOIN public.genie_tenants t ON t.id=i.tenant_id
    JOIN public.genie_memberships creator ON creator.user_id=i.created_by AND creator.tenant_id=i.tenant_id
    JOIN public.genie_users author ON author.id=i.created_by
    WHERE i.token_hash=p_hash AND i.state='pending' AND i.expires_at>now() AND u.enabled AND t.enabled
      AND creator.status='active' AND creator.role='admin' AND author.enabled
      AND u.issuer=p_issuer AND u.subject=p_subject
$$;

CREATE FUNCTION genie_accept_invite(p_hash text,p_issuer text,p_subject text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE i record; recipient record; prior record;
BEGIN
  SELECT * INTO recipient FROM public.genie_invite_recipient(p_hash,p_issuer,p_subject);
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||recipient.tenant_id::text,0));
  -- Recheck after acquiring the same tenant lock used by deactivation/revocation.
  SELECT * INTO recipient FROM public.genie_invite_recipient(p_hash,p_issuer,p_subject);
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO i FROM public.genie_membership_invites WHERE token_hash=p_hash FOR UPDATE;
  SELECT role,status INTO prior FROM public.genie_memberships WHERE user_id=recipient.user_id AND tenant_id=i.tenant_id;
  IF FOUND AND prior.status='active' THEN RAISE EXCEPTION 'already a member' USING ERRCODE='23505'; END IF;
  INSERT INTO public.genie_memberships(user_id,tenant_id,status,role,review_reference)
    VALUES(recipient.user_id,i.tenant_id,'active',i.role,'accepted reviewed invitation '||i.id::text)
    ON CONFLICT(user_id,tenant_id) DO UPDATE SET status='active',role=excluded.role,review_reference=excluded.review_reference,version=public.genie_memberships.version+1;
  UPDATE public.genie_membership_invites SET state='accepted' WHERE id=i.id;
  INSERT INTO public.genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
    VALUES(i.tenant_id,recipient.user_id,recipient.user_id,'invitation_accepted',
      jsonb_build_object('status',prior.status,'role',prior.role),
      jsonb_build_object('status','active','role',i.role,'invitationId',i.id,'approvedBy',i.created_by));
  RETURN jsonb_build_object('userId',recipient.user_id,'tenantId',i.tenant_id);
END $$;

REVOKE ALL ON FUNCTION genie_admin_actor(text),genie_change_member(text,uuid,text,text,bigint),
  genie_create_invite(text,uuid,text,text),genie_revoke_invite(text,uuid),
  genie_invite_recipient(text,text,text),genie_accept_invite(text,text,text) FROM PUBLIC;

CREATE FUNCTION genie_membership_page(p_session text,p_kind text,p_after text DEFAULT NULL,p_search text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; result jsonb;
BEGIN
  SELECT * INTO a FROM public.genie_admin_actor(p_session);
  IF p_kind IS NULL OR p_kind NOT IN ('members','people','invitations','audit') OR length(p_search)>80 OR length(p_after)>64
    THEN RAISE EXCEPTION 'invalid page request' USING ERRCODE='22023'; END IF;
  IF p_kind='members' THEN
    WITH page AS (
      SELECT m.user_id::text cursor,jsonb_build_object('userId',m.user_id,'displayName',coalesce(p.display_name,'Workspace member'),'status',m.status,'role',m.role,'version',m.version::text) item
      FROM public.genie_memberships m LEFT JOIN public.genie_workspace_people p ON p.tenant_id=m.tenant_id AND p.user_id=m.user_id
      WHERE m.tenant_id=a.tenant_id AND (p_after IS NULL OR m.user_id>p_after::uuid)
        AND position(lower(p_search) IN lower(coalesce(p.display_name,'Workspace member')))>0
      ORDER BY m.user_id LIMIT 51
    ), shown AS (SELECT * FROM page ORDER BY cursor LIMIT 50)
    SELECT jsonb_build_object('items',coalesce(jsonb_agg(item ORDER BY cursor),'[]'::jsonb),
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT cursor FROM shown ORDER BY cursor DESC LIMIT 1) END) INTO result FROM shown;
  ELSIF p_kind='people' THEN
    WITH page AS (
      SELECT p.user_id::text cursor,jsonb_build_object('userId',p.user_id,'displayName',p.display_name) item
      FROM public.genie_workspace_people p JOIN public.genie_users u ON u.id=p.user_id
      WHERE p.tenant_id=a.tenant_id AND u.enabled AND u.issuer=(SELECT issuer FROM public.genie_users WHERE id=a.user_id)
        AND (p_after IS NULL OR p.user_id>p_after::uuid) AND position(lower(p_search) IN lower(p.display_name))>0
        AND NOT EXISTS(SELECT 1 FROM public.genie_memberships m WHERE m.tenant_id=p.tenant_id AND m.user_id=p.user_id AND m.status='active')
      ORDER BY p.user_id LIMIT 51
    ), shown AS (SELECT * FROM page ORDER BY cursor LIMIT 50)
    SELECT jsonb_build_object('items',coalesce(jsonb_agg(item ORDER BY cursor),'[]'::jsonb),
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT cursor FROM shown ORDER BY cursor DESC LIMIT 1) END) INTO result FROM shown;
  ELSIF p_kind='invitations' THEN
    WITH page AS (
      SELECT i.id::text cursor,jsonb_build_object('id',i.id,'displayName',coalesce(p.display_name,'Reviewed account'),'role',i.role,'expiresAt',i.expires_at,'state',i.state) item
      FROM public.genie_membership_invites i LEFT JOIN public.genie_workspace_people p ON p.tenant_id=i.tenant_id AND p.user_id=i.recipient_id
      WHERE i.tenant_id=a.tenant_id AND i.state='pending' AND i.expires_at>now() AND (p_after IS NULL OR i.id>p_after::uuid)
        AND position(lower(p_search) IN lower(coalesce(p.display_name,'Reviewed account')))>0
      ORDER BY i.id LIMIT 51
    ), shown AS (SELECT * FROM page ORDER BY cursor LIMIT 50)
    SELECT jsonb_build_object('items',coalesce(jsonb_agg(item ORDER BY cursor),'[]'::jsonb),
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT cursor FROM shown ORDER BY cursor DESC LIMIT 1) END) INTO result FROM shown;
  ELSE
    WITH page AS (
      SELECT e.id cursor,jsonb_build_object('id',e.id::text,'actor',coalesce(actor.display_name,'Workspace member'),
        'target',coalesce(target.display_name,'Workspace member'),'action',e.action,'before',e.before_state,'after',e.after_state,'createdAt',e.created_at) item
      FROM public.genie_membership_audit e
      LEFT JOIN public.genie_workspace_people actor ON actor.tenant_id=e.tenant_id AND actor.user_id=e.actor_id
      LEFT JOIN public.genie_workspace_people target ON target.tenant_id=e.tenant_id AND target.user_id=e.target_id
      WHERE e.tenant_id=a.tenant_id AND (p_after IS NULL OR e.id<p_after::bigint) ORDER BY e.id DESC LIMIT 51
    ), shown AS (SELECT * FROM page ORDER BY cursor DESC LIMIT 50)
    SELECT jsonb_build_object('items',coalesce(jsonb_agg(item ORDER BY cursor DESC),'[]'::jsonb),
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT cursor::text FROM shown ORDER BY cursor LIMIT 1) END) INTO result FROM shown;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION genie_membership_page(text,text,text,text) FROM PUBLIC;
