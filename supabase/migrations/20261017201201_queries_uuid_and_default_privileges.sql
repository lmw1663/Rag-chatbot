-- 2일차(/api/chat, 피드백) 전에 queries/feedback 스키마를 바꾸고, 앞으로 만들 객체의 기본 권한을 정리한다.
-- 1) queries.id: 순번(bigint) → uuid. 피드백 버튼이 id를 브라우저로 보내므로, 추측 가능한 순번이면 남의 답변에 피드백을 조작할 수 있다.
-- 2) retrieved_chunk_ids(bigint[]) → retrieved_chunks(jsonb 스냅샷). 재인제스트하면 청크 id가 바뀌어 예전 로그가 깨진다.
-- 3) 기본 권한: 새 테이블·시퀀스·함수에 anon, authenticated 권한이 자동으로 붙지 않게 한다.

-- 안전장치: 두 테이블을 지우고 다시 만들므로, 데이터가 있으면 중단한다.
do $$
begin
  if exists (select 1 from public.queries) or exists (select 1 from public.feedback) then
    raise exception 'queries 또는 feedback에 데이터가 있어 재생성을 중단합니다';
  end if;
end;
$$;

drop table public.feedback;
drop table public.queries;

-- 사용자 질문 로그. answered = false인 행이 "답 못 한 질문" 집계 대상이다.
create table public.queries (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text,
  answered boolean not null,
  model text,
  prompt_version text,
  latency_ms int,
  top_similarity real,
  -- 답변 근거로 쓴 검색 결과 스냅샷: [{ "slug": "fryer-oil", "heading": "교체 순서", "similarity": 0.62 }, ...]
  retrieved_chunks jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- 답변별 👍(1) / 👎(-1). 답변 하나에 피드백 하나만 남는다(다시 누르면 upsert).
create table public.feedback (
  id bigint generated always as identity primary key,
  query_id uuid not null unique references public.queries (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  created_at timestamptz not null default now()
);

alter table public.queries enable row level security;
alter table public.feedback enable row level security;

revoke all on public.queries, public.feedback from anon, authenticated;
grant select, insert, update, delete on public.queries, public.feedback to service_role;
grant usage, select on sequence public.feedback_id_seq to service_role;

-- 앞으로 postgres가 public 스키마에 만드는 객체의 기본 권한에서 anon, authenticated를 뺀다.
-- (함수는 PostgreSQL 기본값으로 PUBLIC에 실행 권한이 있으므로 PUBLIC도 뺀다)
-- 새 객체의 service_role 권한은 지금처럼 마이그레이션마다 명시적으로 GRANT한다.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
