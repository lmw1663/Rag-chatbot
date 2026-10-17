# VERIFICATION

AI가 만든 코드에서 발견한 버그·보안 문제 기록.

## 2026-10-17: 새 테이블에 anon, authenticated 권한이 남아 있음

- **문제**: 초기 스키마 마이그레이션(`20261016190700_init_schema.sql`) 적용 후 권한을 조회하니, 4개 테이블(`documents`, `chunks`, `queries`, `feedback`) 모두 `anon`과 `authenticated`에 `TRUNCATE`, `REFERENCES`, `TRIGGER` 권한이 있었다. TRUNCATE는 RLS가 막지 못한다.
- **원인**: 대시보드에서 "Automatically expose new tables"를 꺼도 Supabase의 기본 권한(default privileges)에서는 SELECT, INSERT, UPDATE, DELETE만 빠지고 `Dxtm`(TRUNCATE, REFERENCES, TRIGGER, MAINTAIN)은 남는다. AI가 쓴 마이그레이션은 `service_role`에 GRANT만 했고, 새 테이블에 자동으로 붙는 권한을 회수하지 않았다. 실제 권한을 조회하지 않고 "옵션을 껐으니 권한이 없다"고 가정한 것이 원인이다.
- **수정**: 새 마이그레이션 `20261017102358_revoke_anon_authenticated_grants.sql`에서 4개 테이블에 대해 `revoke all ... from anon, authenticated`. 적용 후 `information_schema.role_table_grants` 조회로 `service_role`만 남은 것을 확인했다.
- **교훈**: 권한은 설정 화면이 아니라 DB에서 직접 조회해 확인한다. 새 SQL 함수도 기본적으로 `postgres`만 실행할 수 있으므로, 함수를 만들 때 `service_role`에 EXECUTE를 명시하고 `anon`, `authenticated`에는 주지 않는다.

확인용 쿼리:
```sql
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
group by 1, 2
order by 2, 1;
```
