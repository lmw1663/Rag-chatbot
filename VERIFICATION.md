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

## 2026-10-17: 글자 단위 분할에서 길이 기준이 어긋남 (이모지)

- **문제**: 청커(`lib/chunk-markdown.ts`)의 `splitByChars`가 처음에는 `Array.from(text)`로 문자 배열을 만든 뒤 `maxChars`개씩 잘랐다. 그런데 나머지 코드(`splitToFit`, `pack`)는 `string.length`로 길이를 쟀다. 이모지처럼 `length`가 2인 문자가 섞이면 조각의 `length`가 `maxChars`를 넘어, "모든 조각은 최대 길이 이하"라는 규칙이 깨졌다.
- **원인**: AI가 이모지가 반으로 갈리지 않게 하려고 문자(code point) 단위를 썼지만, 같은 파일의 다른 함수가 쓰는 길이 기준(UTF-16 `length`)과 맞추지 않았다. 한 파일 안에 길이를 재는 방법이 두 가지 섞여 있었다.
- **수정**: 길이는 `string.length`로 재고, 문자 단위(`Array.from`)로 하나씩 이어 붙이다가 `maxChars`를 넘기 직전에 끊도록 바꿨다. 테스트 "글자 단위로 자를 때 이모지가 반으로 갈리지 않는다"(이모지 5개, `maxChars` 3 → 이모지 1개씩 5조각)로 고정했다.
- **교훈**: 길이 제한이 있는 코드는 "무엇으로 길이를 재는가"를 한 가지로 통일한다. 한국어(BMP)만 테스트하면 이 차이가 드러나지 않으므로, 경계 사례(이모지)를 테스트에 넣는다.

## 2026-10-17: 임베딩 429 재시도 대기가 분당 한도보다 짧음

- **문제**: 첫 인제스트에서 19개 문서 중 15개가 Voyage `429`로 실패했다. 계정에 결제 수단이 없어 한도가 분당 3회 요청, 분당 1만 토큰이었다.
- **원인**: AI가 쓴 `lib/embed.ts`는 429에 1초, 2초 간격으로 최대 3번만 재시도했다. 분 단위 한도는 1분이 지나야 풀리므로 이 대기로는 회복할 수 없다. 게다가 `scripts/ingest.ts`가 문서마다 요청을 따로 보내 요청 수(19번)가 필요 이상으로 많았다. 응답의 `Retry-After`도 보지 않았다.
- **영향**: 데이터 손상은 없었다. 실패는 임베딩 단계에서 났고 저장 함수(`replace_document_chunks`)를 호출하지 않았기 때문이다. 재실행하면 해시로 성공한 문서를 건너뛰고 실패한 문서만 다시 처리된다.
- **수정**: Voyage 결제 수단을 등록해 표준 한도로 올렸고, 재실행으로 19개 모두 저장됐다. **코드는 아직 고치지 않았다.**
- **남은 과제**: (1) 429 응답의 `Retry-After`를 따르고 없으면 더 길게 기다리기, (2) 바뀐 문서들의 청크를 모아 한 번에 임베딩해 요청 수 줄이기(19번 → 1~2번).
- **교훈**: 재시도 로직은 상대 API의 한도 단위(초/분)에 맞춘다. 무료 등급처럼 한도가 낮은 환경에서 한 번 돌려 보면 이런 가정이 바로 드러난다.
