-- Minimal durable conversations. Workspace and owner are enforced at every entry point.
CREATE TABLE genie_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 owner_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120 AND title=btrim(title) AND title !~ '[[:cntrl:]]'),
 message_count integer NOT NULL DEFAULT 0 CHECK(message_count BETWEEN 0 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(owner_id,tenant_id) REFERENCES genie_memberships(user_id,tenant_id)
);
CREATE INDEX genie_conversations_owner ON genie_conversations(tenant_id,owner_id,id);
CREATE TABLE genie_conversation_messages (
 tenant_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 100),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4096 AND length(btrim(content))>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,conversation_id,ordinal),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES genie_conversations(tenant_id,id)
);

-- Browser resources cannot be queried through a retired job context.
CREATE FUNCTION genie_workspace_actor(p_session text,p_mutation boolean)
RETURNS TABLE(user_id uuid,tenant_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT s.tenant_id INTO v_tenant FROM public.genie_sessions s WHERE s.token_hash=p_session AND s.browser_active AND s.expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'workspace session unavailable' USING ERRCODE='42501'; END IF;
 IF p_mutation THEN PERFORM pg_advisory_xact_lock(hashtextextended('genie-membership:'||v_tenant::text,0)); END IF;
 RETURN QUERY SELECT u.id,t.id FROM public.genie_sessions s JOIN public.genie_users u ON u.id=s.user_id
 JOIN public.genie_tenants t ON t.id=s.tenant_id JOIN public.genie_memberships m ON m.tenant_id=t.id AND m.user_id=u.id
 WHERE s.token_hash=p_session AND s.tenant_id=v_tenant AND s.browser_active AND s.expires_at>now()
 AND u.enabled AND t.enabled AND m.status='active' FOR SHARE OF s,u,t,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'workspace session unavailable' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION genie_create_conversation(p_session text,p_title text,p_content text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; v_id uuid;
BEGIN
 SELECT * INTO a FROM public.genie_workspace_actor(p_session,true);
 IF p_title IS NULL OR length(p_title) NOT BETWEEN 1 AND 120 OR p_title<>btrim(p_title) OR p_title~'[[:cntrl:]]'
 OR p_content IS NULL OR length(p_content) NOT BETWEEN 1 AND 4096 OR length(btrim(p_content))=0
 THEN RAISE EXCEPTION 'invalid conversation' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.genie_conversations c WHERE c.tenant_id=a.tenant_id AND c.owner_id=a.user_id)>=100
 THEN RAISE EXCEPTION 'conversation limit' USING ERRCODE='53300'; END IF;
 INSERT INTO public.genie_conversations(tenant_id,owner_id,title,message_count) VALUES(a.tenant_id,a.user_id,p_title,1) RETURNING id INTO v_id;
 INSERT INTO public.genie_conversation_messages(tenant_id,conversation_id,ordinal,content) VALUES(a.tenant_id,v_id,1,p_content);
 RETURN jsonb_build_object('id',v_id,'title',p_title);
END $$;

CREATE FUNCTION genie_append_conversation(p_session text,p_id uuid,p_content text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; v_count integer;
BEGIN
 SELECT * INTO a FROM public.genie_workspace_actor(p_session,true);
 IF p_id IS NULL OR p_content IS NULL OR length(p_content) NOT BETWEEN 1 AND 4096 OR length(btrim(p_content))=0
 THEN RAISE EXCEPTION 'invalid message' USING ERRCODE='22023'; END IF;
 SELECT message_count INTO v_count FROM public.genie_conversations c WHERE c.id=p_id AND c.tenant_id=a.tenant_id AND c.owner_id=a.user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation unavailable' USING ERRCODE='P0002'; END IF;
 IF v_count>=100 THEN RAISE EXCEPTION 'message limit' USING ERRCODE='53300'; END IF;
 INSERT INTO public.genie_conversation_messages(tenant_id,conversation_id,ordinal,content) VALUES(a.tenant_id,p_id,v_count+1,p_content);
 UPDATE public.genie_conversations SET message_count=v_count+1,updated_at=now() WHERE id=p_id;
 RETURN jsonb_build_object('id',p_id,'ordinal',v_count+1);
END $$;

CREATE FUNCTION genie_list_conversations(p_session text,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; result jsonb;
BEGIN
 SELECT * INTO a FROM public.genie_workspace_actor(p_session,false);
 WITH page AS (SELECT c.id,c.title,c.updated_at FROM public.genie_conversations c
  WHERE c.tenant_id=a.tenant_id AND c.owner_id=a.user_id AND (p_after IS NULL OR c.id>p_after) ORDER BY c.id LIMIT 51),
 shown AS (SELECT * FROM page ORDER BY id LIMIT 50)
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'updatedAt',updated_at) ORDER BY id),'[]'::jsonb),
  'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT id FROM shown ORDER BY id DESC LIMIT 1) END)
 INTO result FROM shown;
 RETURN result;
END $$;

CREATE FUNCTION genie_get_conversation(p_session text,p_id uuid,p_after integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; c record; result jsonb;
BEGIN
 SELECT * INTO a FROM public.genie_workspace_actor(p_session,false);
 IF p_id IS NULL OR p_after IS NULL OR p_after NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid conversation cursor' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.genie_conversations r WHERE r.id=p_id AND r.tenant_id=a.tenant_id AND r.owner_id=a.user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation unavailable' USING ERRCODE='P0002'; END IF;
 WITH page AS (SELECT m.ordinal,m.content,m.created_at FROM public.genie_conversation_messages m
  WHERE m.tenant_id=a.tenant_id AND m.conversation_id=p_id AND m.ordinal>p_after ORDER BY m.ordinal LIMIT 51),
 shown AS (SELECT * FROM page ORDER BY ordinal LIMIT 50)
 SELECT jsonb_build_object('id',c.id,'title',c.title,'messages',coalesce(jsonb_agg(jsonb_build_object('ordinal',ordinal,'content',content,'createdAt',created_at) ORDER BY ordinal),'[]'::jsonb),
  'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT max(ordinal) FROM shown) END)
 INTO result FROM shown;
 RETURN result;
END $$;

CREATE FUNCTION genie_search_workspace(p_session text,p_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; result jsonb;
BEGIN
 SELECT * INTO a FROM public.genie_workspace_actor(p_session,false);
 IF p_query IS NULL OR length(p_query) NOT BETWEEN 2 AND 80 OR p_query<>btrim(p_query) OR p_query~'[[:cntrl:]]'
 THEN RAISE EXCEPTION 'invalid workspace search' USING ERRCODE='22023'; END IF;
 WITH hits AS (
  SELECT 'conversation' kind,c.id,c.title label FROM public.genie_conversations c
  WHERE c.tenant_id=a.tenant_id AND c.owner_id=a.user_id AND position(lower(p_query) in lower(c.title))>0
  UNION ALL
  SELECT 'member',p.user_id,p.display_name FROM public.genie_workspace_people p JOIN public.genie_memberships m
    ON m.tenant_id=p.tenant_id AND m.user_id=p.user_id JOIN public.genie_users u ON u.id=p.user_id
  WHERE p.tenant_id=a.tenant_id AND m.status='active' AND u.enabled AND position(lower(p_query) in lower(p.display_name))>0
   AND public.genie_has_permission(a.user_id,a.tenant_id,'workspace.members','read')
  UNION ALL
  SELECT 'role',r.id,r.name FROM public.genie_roles r WHERE r.tenant_id=a.tenant_id AND position(lower(p_query) in lower(r.name))>0
   AND public.genie_has_permission(a.user_id,a.tenant_id,'workspace.roles','read')
 ), bounded AS (SELECT * FROM hits ORDER BY kind,label,id LIMIT 51), shown AS (SELECT * FROM bounded ORDER BY kind,label,id LIMIT 50)
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'label',label) ORDER BY kind,label,id),'[]'::jsonb),
  'truncated',(SELECT count(*) FROM bounded)>50) INTO result FROM shown;
 RETURN result;
END $$;
REVOKE ALL ON TABLE genie_conversations,genie_conversation_messages FROM PUBLIC;
REVOKE ALL ON FUNCTION genie_workspace_actor(text,boolean),genie_create_conversation(text,text,text),
 genie_append_conversation(text,uuid,text),genie_list_conversations(text,uuid),genie_get_conversation(text,uuid,integer),genie_search_workspace(text,text) FROM PUBLIC;
