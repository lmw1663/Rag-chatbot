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

## 2026-10-18: 함수 기본 권한 회수가 효과 없음 (IN SCHEMA)

- **문제**: 마이그레이션 `20261017201201_queries_uuid_and_default_privileges.sql`에서 `alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated`로 새 함수의 공개 실행 권한을 막았다고 판단했다. 적용 후 롤백 트랜잭션 안에서 시험용 함수를 만들어 보니 `proacl`이 `NULL`이었고 `has_function_privilege('anon', ..., 'execute')`가 `true`였다. 즉 새 함수는 여전히 누구나 실행할 수 있었다.
- **원인**: PostgreSQL에서 스키마 단위(`IN SCHEMA`) 기본 권한은 전역 기본 권한에 **더해질** 뿐, 전역 기본값을 뺄 수 없다. 함수의 PUBLIC `EXECUTE`는 PostgreSQL의 전역 기본값이다. AI가 쓴 마이그레이션은 테이블과 같은 방식(`IN SCHEMA` 회수)을 함수에도 적용했고, 문법 오류 없이 적용돼 실패가 드러나지 않았다.
- **수정**: 새 마이그레이션 `20261017201319_revoke_function_execute_from_public.sql`에서 `IN SCHEMA` 없이 `alter default privileges for role postgres revoke execute on functions from public`(전역). 다시 시험용 함수를 만들어 `proacl = {postgres=X/postgres}`, `anon`/`authenticated` 실행 불가를 확인했다. 시험은 `begin … rollback` 안에서 해 잔여 객체는 0이다.
- **영향**: 이 기간에 새로 만든 함수는 없어서 노출된 것은 없었다. 기존 `replace_document_chunks`는 명시적 `revoke`가 있어 처음부터 안전했다.
- **교훈**: "적용 성공"은 "의도대로 동작"이 아니다. 권한 변경은 새 객체를 실제로 만들어 `has_*_privilege`로 확인한다. 앞으로 새 함수는 `service_role`도 기본 실행 권한이 없으므로 `grant execute ... to service_role`을 반드시 쓴다.

## 2026-10-18: 사용자가 연결을 끊으면 질의 로그가 저장되지 않음

- **문제**: `/api/chat`(`app/api/chat/route.ts`)의 첫 버전은 `ReadableStream` 안에서 `controller.enqueue()`로 답변 조각을 보낸 뒤, 끝에서 `queries`에 로그를 저장했다. 답변 도중 사용자가 창을 닫으면 저장이 실행되지 않는 구조였다.
- **원인**: 연결이 끊긴 스트림에 `enqueue()`하면 에러가 난다. AI가 쓴 코드는 이 에러를 `catch`에서 받은 뒤 다시 `send()`로 에러 이벤트를 보내려 했고, 거기서 또 에러가 나 함수가 빠져나갔다. 그래서 그 아래의 `saveQuery()`와 `controller.close()`가 실행되지 않았다. "스트림은 끝까지 열려 있다"고 가정한 것이 원인이다.
- **영향**: 실행 전 코드 검토에서 발견해 실제로 빠진 로그는 없다. 그대로 두었다면 답변 도중 나간 질문이 "답 못 한 질문" 집계와 지연 시간 기록에서 빠졌을 것이다.
- **수정**: `send()`가 `enqueue()` 에러를 잡아 `closed` 플래그만 세우고 이후 전송을 건너뛰게 했다. `controller.close()`도 `closed`가 아닐 때만 호출한다. 이제 연결이 끊겨도 `saveQuery()`까지 실행된다. Claude 요청에는 `request.signal`을 넘겨, 연결이 끊기면 생성도 멈추고 그 질문은 실패(`answered = false`)로 기록된다.
- **교훈**: 스트리밍 응답에서는 "상대가 중간에 사라지는 경우"를 정상 흐름으로 다룬다. 응답 전송과 서버 쪽 마무리(로그 저장)를 분리해, 전송 실패가 마무리를 막지 않게 한다.

## 2026-10-18: 키워드 검색 후보가 유사도 바닥값을 거치지 않음

- **문제**: 혼합 검색 함수 `search_chunks`(`20261018121212_hybrid_search_chunks.sql`)는 유사도 바닥값(`p_min_similarity` 0.1)을 벡터 후보에만 걸었다. 키워드 후보는 `word_similarity > 0`이면 통과했다. 그래서 "주차장 몇 대"처럼 매뉴얼에 없는 질문에도 글자 조각 하나 겹친 청크(키워드 점수 0.125)가 들어왔다. 바닥값이 사실상 효과가 없었고, 결과 0행 → "매뉴얼에 없음" 경로도 거의 열리지 않았다.
- **원인**: AI가 두 검색을 "각자 후보를 뽑아 합친다"는 RRF 구조로만 설계했고, CLAUDE.md에 적은 "바닥값으로 명백히 무관한 청크를 거른다"는 규칙이 키워드 경로에도 적용되는지 확인하지 않았다. 코드와 문서의 설명이 어긋나 있었다.
- **발견**: 2일차 코드 리뷰(`/code-review`).
- **수정**: 새 마이그레이션 `20261018124220_search_chunks_keyword_floor.sql`에서 키워드 후보에도 벡터 유사도 ≥ 바닥값 조건을 추가했다. 키워드 점수를 두 번 계산하던 것도 한 번으로 정리했다. 롤백 트랜잭션으로 시험해, 결과와 실행 권한(`service_role`만)이 유지되는 것을 확인했다.
- **교훈**: 여러 경로를 합치는 로직에서는 "필터가 모든 경로에 걸리는가"를 경로별로 확인한다.

## 2026-10-18: 거절·오류가 "답한 질문" 또는 "매뉴얼에 없음"과 섞여 기록됨

- **문제**: `/api/chat`의 `answered` 판단에 두 가지 구멍이 있었다. (1) Claude가 거절(`stop_reason: "refusal"`)하면 `answer`를 "이 질문에는 답할 수 없습니다."로 덮어썼다. 이 문장은 "매뉴얼에 없음"으로 시작하지 않아 `answered = true`로 기록됐다. 또 화면에는 "앞부분 + 거절 문장"이 보였지만 DB에는 거절 문장만 남아 둘이 달랐다. (2) 오류나 사용자 중단도 `answered = false`로 기록돼, "매뉴얼에 없음"과 구분할 수 없었다.
- **원인**: AI가 `answered`를 "답변이 '매뉴얼에 없음'으로 시작하는가" 하나로만 판단했고, 거절과 실패 경로를 이 기준에 맞춰 보지 않았다.
- **영향**: 실제 거절은 아직 발생하지 않았다. 그대로 두었다면 4일차 "답 못 한 질문 TOP N"에서 거절은 빠지고, 오류나 중단으로 끊긴 질문(매뉴얼에 있는 질문)은 섞였을 것이다.
- **발견**: 2일차 코드 리뷰(`/code-review`).
- **수정**: (1) 거절이면 `refused` 플래그로 `answered = false`로 기록한다. 거절 안내는 덮어쓰지 않고 앞부분 뒤에 덧붙여 화면과 DB를 같게 맞췄다. (2) 오류·중단은 `answer = null`로 저장되므로, 집계 기준을 `answered = false and answer is not null`로 CLAUDE.md "데이터 의미"에 적었다. 같은 리뷰에서 로그 저장이 실패해도 피드백 버튼이 뜨던 문제도 고쳤다(`done`에 `saved`를 실어 저장된 답변에만 버튼 표시).
- **교훈**: 상태 값(`answered`) 하나로 여러 결과를 표현할 때는, 가능한 결과(정상, 근거 없음, 거절, 오류, 중단)를 모두 나열하고 각각이 어떤 값으로 기록되는지 표로 확인한다.
