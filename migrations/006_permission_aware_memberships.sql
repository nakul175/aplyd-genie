-- Preserve existing runtime entry-point grants while applying current resource/action authority.

CREATE OR REPLACE FUNCTION genie_change_member(p_session text,p_target uuid,p_status text,p_role text,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; b record; v_action text; v_count integer;
BEGIN
  SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.members','manage',true);
  IF p_status NOT IN ('active','disabled') OR p_role NOT IN ('member','admin') OR p_status IS NULL OR p_role IS NULL
    THEN RAISE EXCEPTION 'invalid membership change' USING ERRCODE='22023'; END IF;
  SELECT m.status,m.role,m.version INTO b FROM public.genie_memberships m WHERE m.tenant_id=a.tenant_id AND m.user_id=p_target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found' USING ERRCODE='P0002'; END IF;
  IF a.builtin_role<>'admin' AND (b.role='admin' OR p_role='admin') THEN RAISE EXCEPTION 'built-in administrator authority required' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION genie_create_invite(p_session text,p_recipient uuid,p_role text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; i record; expired record;
BEGIN
  SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.invitations','create',true);
  IF p_role IS NULL OR p_role NOT IN ('member','admin') OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'invalid invitation' USING ERRCODE='22023'; END IF;
  IF p_role='admin' AND a.builtin_role<>'admin' THEN RAISE EXCEPTION 'administrator invitation denied' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION genie_revoke_invite(p_session text,p_invitation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; i record;
BEGIN
  SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.invitations','revoke',true);
  SELECT * INTO i FROM public.genie_membership_invites WHERE id=p_invitation AND tenant_id=a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation not found' USING ERRCODE='P0002'; END IF;
  IF i.state<>'pending' THEN RETURN jsonb_build_object('changed',false); END IF;
  UPDATE public.genie_membership_invites SET state='revoked' WHERE id=i.id;
  INSERT INTO public.genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
    VALUES(a.tenant_id,a.user_id,i.recipient_id,'invitation_revoked',jsonb_build_object('invitationId',i.id,'state','pending'),jsonb_build_object('state','revoked'));
  RETURN jsonb_build_object('changed',true);
END $$;

CREATE OR REPLACE FUNCTION genie_invite_recipient(p_hash text,p_issuer text,p_subject text)
RETURNS TABLE(user_id uuid,tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT u.id,i.tenant_id FROM public.genie_membership_invites i
    JOIN public.genie_users u ON u.id=i.recipient_id JOIN public.genie_tenants t ON t.id=i.tenant_id
    JOIN public.genie_memberships creator ON creator.user_id=i.created_by AND creator.tenant_id=i.tenant_id
    JOIN public.genie_users author ON author.id=i.created_by
    WHERE i.token_hash=p_hash AND i.state='pending' AND i.expires_at>now() AND u.enabled AND t.enabled
      AND creator.status='active' AND author.enabled
      AND public.genie_has_permission(creator.user_id,creator.tenant_id,'workspace.invitations','create')
      AND (i.role='member' OR creator.role='admin')
      AND u.issuer=p_issuer AND u.subject=p_subject
$$;

CREATE OR REPLACE FUNCTION genie_membership_page(p_session text,p_kind text,p_after text DEFAULT NULL,p_search text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; result jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('members','people','invitations','audit') OR length(p_search)>80 OR length(p_after)>64
    THEN RAISE EXCEPTION 'invalid page request' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.genie_permission_actor(p_session,CASE p_kind WHEN 'members' THEN 'workspace.members' WHEN 'people' THEN 'workspace.people' WHEN 'invitations' THEN 'workspace.invitations' ELSE 'workspace.audit' END,'read',false);
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
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT min(cursor)::text FROM shown) END) INTO result FROM shown;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION genie_membership_page(text,text,text,text) FROM PUBLIC;

