-- A bounded user-triggered read job demonstrates the same authority at background execution.
CREATE TABLE genie_member_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
 creator_id uuid NOT NULL REFERENCES genie_users(id),
 session_hash char(64) NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','denied','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease uuid,
 lease_expires_at timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),
 deadline timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 result jsonb,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX genie_export_claim ON genie_member_exports(status,available_at,created_at);
CREATE INDEX genie_export_creator ON genie_member_exports(tenant_id,creator_id,created_at DESC);

CREATE FUNCTION genie_enqueue_member_export(p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; v_id uuid;
BEGIN
 SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.members','read',true);
 IF (SELECT count(*) FROM public.genie_member_exports WHERE tenant_id=a.tenant_id AND status IN ('queued','running') AND deadline>now())>=100
 OR (SELECT count(*) FROM public.genie_member_exports WHERE tenant_id=a.tenant_id AND creator_id=a.user_id AND status IN ('queued','running') AND deadline>now())>=3
 THEN RAISE EXCEPTION 'export queue full' USING ERRCODE='53300'; END IF;
 INSERT INTO public.genie_member_exports(tenant_id,creator_id,session_hash) VALUES(a.tenant_id,a.user_id,p_session) RETURNING id INTO v_id;
 RETURN jsonb_build_object('id',v_id,'status','queued');
END $$;

-- Called only by the internal worker. Lease and original principal never reach public responses.
CREATE FUNCTION genie_claim_member_export()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j record; v_lease uuid;
BEGIN
 UPDATE public.genie_member_exports SET status='failed',error='deadline_or_attempt_limit',result=NULL,lease=NULL,lease_expires_at=NULL,finished_at=now()
 WHERE status IN ('queued','running') AND (deadline<=now() OR (attempts>=3 AND (status='queued' OR lease_expires_at<=now())));
 SELECT * INTO j FROM public.genie_member_exports
 WHERE deadline>now() AND attempts<3 AND ((status='queued' AND available_at<=now()) OR (status='running' AND lease_expires_at<=now()))
 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 v_lease:=gen_random_uuid();
 UPDATE public.genie_member_exports SET status='running',attempts=attempts+1,lease=v_lease,lease_expires_at=now()+interval '60 seconds' WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'lease',v_lease,'sessionHash',j.session_hash,'userId',j.creator_id,'tenantId',j.tenant_id);
END $$;

CREATE FUNCTION genie_finish_member_export(p_id uuid,p_lease uuid,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j record; a record; output jsonb; v_truncated boolean;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('ready','denied','retry') THEN RAISE EXCEPTION 'invalid outcome' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM public.genie_member_exports WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.status<>'running' OR j.lease IS DISTINCT FROM p_lease OR p_lease IS NULL OR j.lease_expires_at<=now()
 THEN RAISE EXCEPTION 'export lease unavailable' USING ERRCODE='40001'; END IF;
 IF j.deadline<=now() THEN
  UPDATE public.genie_member_exports SET status='failed',error='deadline_expired',result=NULL,lease=NULL,lease_expires_at=NULL,finished_at=now() WHERE id=j.id;
  RETURN jsonb_build_object('status','failed');
 END IF;
 IF p_outcome='retry' THEN
  UPDATE public.genie_member_exports SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,error='source_unavailable',
    available_at=now()+interval '10 seconds'*attempts,result=NULL,lease=NULL,lease_expires_at=NULL,
    finished_at=CASE WHEN attempts>=3 THEN now() ELSE NULL END WHERE id=j.id;
  RETURN jsonb_build_object('status',CASE WHEN j.attempts<3 THEN 'queued' ELSE 'failed' END);
 END IF;
 IF p_outcome='ready' THEN
  BEGIN
   SELECT * INTO a FROM public.genie_permission_actor(j.session_hash,'workspace.members','read',true);
   IF a.user_id<>j.creator_id OR a.tenant_id<>j.tenant_id THEN RAISE EXCEPTION 'job actor changed' USING ERRCODE='42501'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN p_outcome:='denied';
  END;
 END IF;
 IF p_outcome='denied' THEN
  UPDATE public.genie_member_exports SET status='denied',error='authorization_lost',result=NULL,lease=NULL,lease_expires_at=NULL,finished_at=now() WHERE id=j.id;
  RETURN jsonb_build_object('status','denied');
 END IF;
 WITH members AS (
  SELECT m.user_id,coalesce(p.display_name,'Workspace member') name,m.status,m.role
   FROM public.genie_memberships m LEFT JOIN public.genie_workspace_people p ON p.tenant_id=m.tenant_id AND p.user_id=m.user_id
   WHERE m.tenant_id=j.tenant_id ORDER BY m.user_id LIMIT 1001
 ), shown AS (SELECT * FROM members ORDER BY user_id LIMIT 1000)
 SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'status',status,'role',role) ORDER BY user_id),'[]'::jsonb),
  (SELECT count(*) FROM members)>1000 INTO output,v_truncated FROM shown;
 UPDATE public.genie_member_exports SET status='completed',error=NULL,result=jsonb_build_object('items',output,'truncated',v_truncated),
  lease=NULL,lease_expires_at=NULL,finished_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('status','completed');
END $$;

CREATE FUNCTION genie_get_member_export(p_session text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a record; j record;
BEGIN
 SELECT * INTO a FROM public.genie_permission_actor(p_session,'workspace.members','read',false);
 SELECT * INTO j FROM public.genie_member_exports WHERE id=p_id AND tenant_id=a.tenant_id AND creator_id=a.user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'export unavailable' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('id',j.id,'status',CASE WHEN j.status IN ('queued','running') AND j.deadline<=now() THEN 'failed' ELSE j.status END,
  'error',CASE WHEN j.status IN ('queued','running') AND j.deadline<=now() THEN 'deadline_expired' ELSE j.error END,
  'result',CASE WHEN j.status='completed' THEN j.result ELSE NULL END,'createdAt',j.created_at,'finishedAt',j.finished_at);
END $$;
REVOKE ALL ON TABLE genie_member_exports FROM PUBLIC;
REVOKE ALL ON FUNCTION genie_enqueue_member_export(text),genie_claim_member_export(),
 genie_finish_member_export(uuid,uuid,text),genie_get_member_export(text,uuid) FROM PUBLIC;
