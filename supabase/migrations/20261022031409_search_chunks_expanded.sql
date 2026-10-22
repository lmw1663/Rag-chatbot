-- 검색 결과를 문서 단위로 넓히는 함수 (small-to-big): 청크로 검색하고, 모델에게는 상위 문서의 청크 전체를 준다.
--
-- 3일차 평가에서 정답 문서는 1~2위로 찾았는데, 답에 필요한 청크가 13위 이하로 밀린 문항이 3개 있었다.
-- (예: "알바가 지각하면 어떻게 해요?" → 근태 문서는 1위, "지각할 것 같을 때" 청크는 13위)
-- 상위 k개를 늘리면 무관한 청크도 같이 늘어나므로, 대신 순위가 높은 문서 p_doc_count개의 청크를 모두 넣는다.
-- 매뉴얼 문서는 1~2KB로 짧아서 문서 전체를 넣어도 프롬프트가 크게 늘지 않는다.
--
-- 반환: search_chunks 결과(다른 문서의 청크 포함) + 상위 문서의 나머지 청크.
-- 순서는 문서 순위(그 문서에서 가장 높은 청크 순위) → 문서 안의 원래 순서(chunk_index). 모델이 문서를 원문 순서로 읽게 한다.
-- 검색 결과가 0행이면 이 함수도 0행이다("매뉴얼에 없음" 처리 경로 유지).

create function public.search_chunks_expanded(
  p_query_text text,
  p_query_embedding extensions.vector(1024),
  p_match_count int default 5, -- search_chunks가 고르는 청크 수
  p_doc_count int default 2, -- 청크 전체를 넣을 상위 문서 수
  p_candidate_count int default 20,
  p_min_similarity real default 0.1
)
returns table (
  chunk_id bigint,
  slug text,
  title text,
  heading text,
  content text,
  similarity real,
  keyword_score real,
  rrf_score double precision -- 검색에서 직접 뽑히지 않고 넓혀서 들어온 청크는 0
)
language sql
stable
security invoker
set search_path = ''
as $$
  with hits as (
    select h.chunk_id, h.slug, h.rrf_score, row_number() over (order by h.rrf_score desc, h.chunk_id) as hit_rank
    from public.search_chunks(p_query_text, p_query_embedding, p_match_count, p_candidate_count, p_min_similarity) h
  ),
  doc_rank as (
    -- 문서 순위 = 그 문서에서 가장 높은 청크의 순위
    select d.id as document_id, min(h.hit_rank) as best_rank
    from hits h
    join public.documents d on d.slug = h.slug
    group by d.id
  ),
  expanded_docs as (
    select document_id
    from doc_rank
    order by best_rank
    limit greatest(p_doc_count, 0)
  ),
  selected as (
    -- 상위 문서의 모든 청크 + 그 밖의 문서에서 검색된 청크 (union이라 겹치는 청크는 한 번만)
    select c.id
    from public.chunks c
    join expanded_docs e on e.document_id = c.document_id
    union
    select chunk_id from hits
  )
  select
    c.id,
    d.slug,
    d.title,
    c.heading,
    c.content,
    (1 - (c.embedding operator(extensions.<=>) p_query_embedding))::real,
    extensions.word_similarity(p_query_text, c.content)::real,
    coalesce(h.rrf_score, 0)
  from selected s
  join public.chunks c on c.id = s.id
  join public.documents d on d.id = c.document_id
  join doc_rank r on r.document_id = c.document_id
  left join hits h on h.chunk_id = c.id
  order by r.best_rank, c.chunk_index;
$$;

-- 서버(service_role)만 호출할 수 있게 한다. 이 함수는 security invoker라 안에서 부르는 search_chunks의 실행 권한도 필요하다(이미 service_role에 있음).
revoke execute on function public.search_chunks_expanded(text, extensions.vector, int, int, int, real)
  from public, anon, authenticated;
grant execute on function public.search_chunks_expanded(text, extensions.vector, int, int, int, real)
  to service_role;
