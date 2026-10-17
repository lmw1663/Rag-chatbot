-- "Automatically expose new tables"를 꺼도 Supabase 기본 권한에는 TRUNCATE, REFERENCES, TRIGGER가 남아
-- 새 테이블에 anon, authenticated 권한이 붙는다. TRUNCATE는 RLS가 막지 못하므로 전부 회수한다.
-- 접근은 service_role(서버)만 한다.
revoke all
  on public.documents, public.chunks, public.queries, public.feedback
  from anon, authenticated;
