-- 3일차 보안 점검: public.rls_auto_enable()을 anon, authenticated가 실행할 수 있었다.
--
-- 이 함수는 Supabase 대시보드의 "새 테이블에 RLS 자동 적용" 설정이 만든 이벤트 트리거(ensure_rls) 함수다.
-- 마이그레이션 밖에서 만들어졌고, 함수 기본 실행 권한을 전역으로 회수(20261017201319)하기 전에 생겨 PUBLIC 실행 권한이 남아 있었다.
-- SECURITY DEFINER(소유자 postgres 권한으로 실행)라서, 하는 일이 "새 테이블에 RLS 켜기"뿐이어도 최소 권한 원칙에 맞게 회수한다.
-- 실제 위험은 낮았다: 인자가 없고, anon으로 직접 실행해도 처리할 DDL이 없어 아무것도 바꾸지 않았다.
--
-- 이벤트 트리거는 실행 권한과 상관없이 동작한다. 롤백 트랜잭션에서 회수 후 새 테이블을 만들어 RLS가 켜지는 것을 확인했다.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
