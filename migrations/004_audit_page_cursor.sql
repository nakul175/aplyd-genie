-- Migration 003 is already deployed: preserve its checksum and repair the function here.
-- min() uses the bigint event ID before casting; sorting the output alias sorted text.
CREATE OR REPLACE FUNCTION genie_membership_page(p_session text,p_kind text,p_after text DEFAULT NULL,p_search text DEFAULT '')
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
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT min(cursor)::text FROM shown) END) INTO result FROM shown;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION genie_membership_page(text,text,text,text) FROM PUBLIC;
