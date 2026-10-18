-- 질문과 관련된 청크를 찾는 혼합 검색 함수: 벡터 검색 + 키워드(trigram) 검색 결과를 RRF로 합친다.
-- 벡터 검색만으로는 "지각" 같은 짧은 단어를 약하게 잡아 근태 문서가 5~9위로 밀렸다(1일차 실측).
-- 키워드 검색은 글자 조각(trigram)이 겹치는 청크를 찾아 이 약점을 메운다. 한글도 trigram으로 쪼개짐을 확인했다.
--
-- RRF(Reciprocal Rank Fusion): 점수 대신 순위로 합친다. 각 검색에서의 순위 r마다 1/(60 + r)을 더한다.
-- 코사인 유사도와 trigram 점수는 단위가 달라 직접 더할 수 없어서 순위를 쓴다. 60은 RRF 논문의 관례값이다.
--
-- "근거 없음" 판단: 매뉴얼에 없는 질문의 점수가 정답 점수보다 높은 경우가 있어(0.318 > 0.287) 임계값만으로는 판단할 수 없다.
-- p_min_similarity는 명백히 무관한 청크만 거르는 낮은 바닥값이고, 최종 판단은 프롬프트에서 한다.
-- 결과가 0행이면 LLM을 부르지 않고 바로 "매뉴얼에 없음"으로 처리한다.

create extension if not exists pg_trgm with schema extensions;

create function public.search_chunks(
  p_query_text text,
  p_query_embedding extensions.vector(1024),
  p_match_count int default 5, -- 최종으로 돌려줄 청크 수 (1~20으로 제한)
  p_candidate_count int default 20, -- 각 검색에서 뽑는 후보 수
  p_min_similarity real default 0.1 -- 벡터 후보의 코사인 유사도 바닥값
)
returns table (
  chunk_id bigint,
  slug text,
  title text,
  heading text,
  content text,
  similarity real, -- 코사인 유사도. 키워드로만 뽑힌 청크도 계산해서 돌려준다(queries.top_similarity 로그용)
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
    -- 하나도 겹치지 않는 청크(0)는 후보에서 뺀다. 청크가 100개 미만이라 trigram 인덱스 없이 전체를 훑는다
    select c.id, extensions.word_similarity(p_query_text, c.content) as score
    from public.chunks c
    where extensions.word_similarity(p_query_text, c.content) > 0
    order by score desc, c.id
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

-- 서버(service_role)만 호출할 수 있게 한다. 전역 기본 권한으로 PUBLIC 실행 권한은 없지만, 이전 함수와 같이 명시한다.
revoke execute on function public.search_chunks(text, extensions.vector, int, int, real)
  from public, anon, authenticated;
grant execute on function public.search_chunks(text, extensions.vector, int, int, real)
  to service_role;
