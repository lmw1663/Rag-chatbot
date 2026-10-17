-- 직전 마이그레이션(20261017201201)의 함수 기본 권한 회수는 효과가 없었다.
-- PostgreSQL에서 스키마 단위(IN SCHEMA) 기본 권한은 전역 기본값에 권한을 "더할" 수만 있고 뺄 수는 없다.
-- 함수의 PUBLIC 실행 권한은 전역 기본값이므로, IN SCHEMA 없이 전역으로 회수해야 한다.
-- (확인: 회수 후에도 postgres가 만든 새 함수의 proacl이 NULL이고 anon이 실행 가능했다)
--
-- 적용 범위: postgres가 앞으로 만드는 모든 스키마의 함수. 새 함수의 실행 권한은 마이그레이션마다 명시적으로 GRANT한다.
alter default privileges for role postgres
  revoke execute on functions from public;
