-- 초기 스키마: 매뉴얼 문서, 청크(임베딩), 질의 로그, 피드백
-- 접근은 서버의 secret(service role) 키로만 한다. 모든 테이블에 RLS를 켜고 공개 정책은 두지 않는다.

create extension if not exists vector with schema extensions;

-- 매뉴얼 문서 1개 = 1행. slug(파일명 기준)로 같은 문서를 식별해 재인제스트 시 upsert한다.
create table public.documents (
  id bigint generated always as identity primary key,
  slug text not null unique,
  title text not null,
  category text,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 문서를 헤딩 기준으로 자른 조각. 문서가 삭제되면 청크도 함께 삭제된다.
create table public.chunks (
  id bigint generated always as identity primary key,
  document_id bigint not null references public.documents (id) on delete cascade,
  chunk_index int not null,
  heading text,
  content text not null,
  embedding extensions.vector(1024) not null,
  embedding_model text not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

-- 코사인 유사도 검색용 인덱스
create index chunks_embedding_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- 사용자 질문 로그. answered = false인 행이 "답 못 한 질문" 집계 대상이다.
create table public.queries (
  id bigint generated always as identity primary key,
  question text not null,
  answer text,
  answered boolean not null,
  model text,
  prompt_version text,
  latency_ms int,
  top_similarity real,
  retrieved_chunk_ids bigint[] not null default '{}',
  created_at timestamptz not null default now()
);

-- 답변별 👍(1) / 👎(-1). 답변 하나에 피드백 하나만 남는다(다시 누르면 upsert).
create table public.feedback (
  id bigint generated always as identity primary key,
  query_id bigint not null unique references public.queries (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.queries enable row level security;
alter table public.feedback enable row level security;

-- "Automatically expose new tables"를 꺼 두었으므로 기본 권한이 없다.
-- 서버(secret 키 = service_role)에만 명시적으로 권한을 준다. anon, authenticated에는 주지 않는다.
grant select, insert, update, delete
  on public.documents, public.chunks, public.queries, public.feedback
  to service_role;

-- identity 컬럼이 쓰는 시퀀스 권한 (이 시점의 public 시퀀스는 위 4개 테이블 것뿐이다)
grant usage, select on all sequences in schema public to service_role;
