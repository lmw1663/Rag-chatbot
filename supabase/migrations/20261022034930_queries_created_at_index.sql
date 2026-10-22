-- queries.created_at 인덱스.
-- /api/chat의 전체 사용량 상한(lib/rate-limit.ts)이 요청마다 "최근 1분, 24시간" 질문 수를 created_at 범위로 센다.
-- 인덱스가 없으면 로그가 쌓일수록 요청마다 테이블 전체를 훑는다. 4일차 관리자 집계(기간별 답 못 한 질문)도 이 컬럼을 쓴다.
create index queries_created_at_idx on public.queries (created_at);
