-- 관리자 페이지(/admin) 집계 함수: 요약 지표, 👎 많은 질문 TOP N, 답 못 한 질문 TOP N.
--
-- 같은 질문을 공백이나 대소문자만 다르게 물은 것은 하나로 센다(앞뒤 공백 제거, 연속 공백을 하나로, 소문자).
-- "답 못 한 질문"은 answered = false and answer is not null이다. answer가 null이면 오류나 사용자 중단이라
-- 매뉴얼에 있는 질문도 섞이므로 빼고, 따로 failed로 센다(CLAUDE.md "데이터 의미").
-- p_days: 최근 며칠을 볼지. 1~365로 제한한다.

-- 질문 묶음 키. 세 함수가 같은 기준을 쓰도록 하나로 둔다
create function public.normalize_question(p_question text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_question), '\s+', ' ', 'g'));
$$;

create function public.admin_summary(p_days int default 30)
returns table (
  total bigint, -- 전체 질문 수
  answered bigint, -- 근거로 답한 질문
  unanswered bigint, -- 매뉴얼에 없음 또는 거절
  failed bigint, -- 오류나 사용자 중단 (answer is null)
  upvotes bigint,
  downvotes bigint,
  median_latency_ms int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select q.*
    from public.queries q
    where q.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))
  )
  select
    count(*),
    count(*) filter (where r.answered),
    count(*) filter (where not r.answered and r.answer is not null),
    count(*) filter (where r.answer is null),
    (select count(*) from public.feedback f join recent x on x.id = f.query_id where f.rating = 1),
    (select count(*) from public.feedback f join recent x on x.id = f.query_id where f.rating = -1),
    (percentile_cont(0.5) within group (order by r.latency_ms))::int
  from recent r;
$$;

create function public.admin_top_unanswered(p_limit int default 10, p_days int default 30)
returns table (
  question text, -- 묶음에서 가장 최근에 들어온 원문
  times bigint,
  last_asked_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (array_agg(q.question order by q.created_at desc))[1],
    count(*),
    max(q.created_at)
  from public.queries q
  where not q.answered
    and q.answer is not null
    and q.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))
  group by public.normalize_question(q.question)
  order by count(*) desc, max(q.created_at) desc
  limit least(greatest(p_limit, 1), 50);
$$;

create function public.admin_top_downvoted(p_limit int default 10, p_days int default 30)
returns table (
  question text, -- 묶음에서 가장 최근에 👎를 받은 원문
  downvotes bigint,
  upvotes bigint,
  latest_downvoted_answer text, -- 무엇이 문제였는지 바로 보도록 가장 최근에 👎 받은 답변
  last_asked_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (array_agg(q.question order by q.created_at desc) filter (where f.rating = -1))[1],
    count(*) filter (where f.rating = -1),
    count(*) filter (where f.rating = 1),
    (array_agg(q.answer order by q.created_at desc) filter (where f.rating = -1))[1],
    max(q.created_at)
  from public.queries q
  join public.feedback f on f.query_id = q.id
  where q.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))
  group by public.normalize_question(q.question)
  having count(*) filter (where f.rating = -1) > 0
  order by count(*) filter (where f.rating = -1) desc, max(q.created_at) desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- 서버(service_role)만 호출할 수 있게 한다. 질문 원문(사용자 입력)을 돌려주므로 anon에 열리면 안 된다
revoke execute on function public.normalize_question(text) from public, anon, authenticated;
revoke execute on function public.admin_summary(int) from public, anon, authenticated;
revoke execute on function public.admin_top_unanswered(int, int) from public, anon, authenticated;
revoke execute on function public.admin_top_downvoted(int, int) from public, anon, authenticated;
grant execute on function public.normalize_question(text) to service_role;
grant execute on function public.admin_summary(int) to service_role;
grant execute on function public.admin_top_unanswered(int, int) to service_role;
grant execute on function public.admin_top_downvoted(int, int) to service_role;
