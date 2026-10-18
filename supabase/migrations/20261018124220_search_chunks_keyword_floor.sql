-- search_chunks 수정: 키워드 후보에도 벡터 유사도 바닥값(p_min_similarity)을 적용한다.
--
-- 직전 버전(20261018121212)은 바닥값을 벡터 후보에만 걸었다. 키워드 후보는 word_similarity > 0이면 통과해서,
-- 흔한 글자 조각 하나만 겹쳐도(예: "주차장 몇 대" → 무관한 청크가 0.125) 결과에 들어왔다.
-- 그래서 바닥값이 사실상 효과가 없었고, 결과가 0행이 되어 LLM 호출 없이 "매뉴얼에 없음"으로 끝나는 경로도 거의 열리지 않았다.
-- 이제 두 검색 모두 "벡터 유사도가 바닥값 이상인 청크" 안에서만 후보를 고른다.
-- 키워드 검색은 그 안에서 순위를 올려 주는 역할만 한다(벡터가 약하게 잡은 "지각" 같은 단어 보강).
--
-- 함께 정리: 키워드 점수를 WHERE와 SELECT에서 두 번 계산하던 것을 서브쿼리에서 한 번만 계산한다.
-- 인자와 반환 형식은 그대로라 create or replace로 교체하고, 기존 실행 권한(service_role만)도 유지된다.

create or replace function public.search_chunks(
  p_query_text text,
  p_query_embedding extensions.vector(1024),
  p_match_count int default 5, -- 최종으로 돌려줄 청크 수 (1~20으로 제한)
  p_candidate_count int default 20, -- 각 검색에서 뽑는 후보 수
  p_min_similarity real default 0.1 -- 코사인 유사도 바닥값. 두 검색의 후보 모두에 적용한다
)
returns table (
  chunk_id bigint,
  slug text,
  title text,
  heading text,
  content text,
  similarity real, -- 코사인 유사도 (queries.top_similarity 로그용)
  keyword_score real, -- trigram word_similarity
  rrf_score double precision
)
language sql
stable
security invoker -- 호출한 역할(service_role)의 권한으로 실행한다
set search_path = '' -- 모든 이름을 스키마까지 적는다. 그래서 연산자도 operator(extensions.<=>)로 쓴다
as $$
  with vector_candidates as (
    -- 코사인 거리(<=>)가 가까운 순. ORDER BY 거리 + LIMIT 형태여야 HNSW 인덱스를 탈 수 있다
    select c.id, c.embedding operator(extensions.<=>) p_query_embedding as distance
    from public.chunks c
    where 1 - (c.embedding operator(extensions.<=>) p_query_embedding) >= p_min_similarity
    order by distance
    limit p_candidate_count
  ),
  vector_ranked as (
    select id, row_number() over (order by distance) as rank
    from vector_candidates
  ),
  keyword_candidates as (
    -- word_similarity(질문, 본문): 질문의 trigram이 본문의 어느 구간과 얼마나 겹치는지(0~1).
    -- 점수는 서브쿼리에서 한 번만 계산한다. 청크가 100개 미만이라 trigram 인덱스 없이 전체를 훑는다
    select s.id, s.score
    from (
      select
        c.id,
        extensions.word_similarity(p_query_text, c.content) as score,
        1 - (c.embedding operator(extensions.<=>) p_query_embedding) as similarity
      from public.chunks c
    ) s
    where s.score > 0
      and s.similarity >= p_min_similarity -- 벡터로 봐도 명백히 무관한 청크는 글자가 겹쳐도 뺀다
    order by s.score desc, s.id
    limit p_candidate_count
  ),
  keyword_ranked as (
    select id, score, row_number() over (order by score desc, id) as rank
    from keyword_candidates
  ),
  fused as (
    -- 한쪽 검색에만 나온 청크도 남기려고 full outer join. 없는 쪽 순위의 점수는 0으로 친다
    select
      coalesce(v.id, k.id) as id,
      k.score as keyword_score,
      coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + k.rank), 0) as rrf_score
    from vector_ranked v
    full outer join keyword_ranked k on k.id = v.id
  )
  select
    c.id,
    d.slug,
    d.title,
    c.heading,
    c.content,
    (1 - (c.embedding operator(extensions.<=>) p_query_embedding))::real,
    coalesce(f.keyword_score, 0)::real,
    f.rrf_score
  from fused f
  join public.chunks c on c.id = f.id
  join public.documents d on d.id = c.document_id
  order by f.rrf_score desc, c.id
  limit least(greatest(p_match_count, 1), 20);
$$;
