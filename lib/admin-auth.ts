// 관리자 페이지(/admin) HTTP Basic 인증. proxy.ts(사전 확인)와 lib/admin.ts(데이터를 읽기 직전 확인)가 같이 쓴다.
// 사용자 질문 원문을 보여 주는 페이지라, 환경 변수가 없으면 모두 막는다(fail-closed).
// 서버 전용: ADMIN_PASSWORD를 쓴다. NEXT_PUBLIC_ 접두사를 붙이지 않는다.
import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_REALM = "rag-chatbot-admin";

type AdminEnv = Record<string, string | undefined>; // ADMIN_USERNAME, ADMIN_PASSWORD만 읽는다

export function isAuthorizedAdmin(authorization: string | null, env: AdminEnv = process.env): boolean {
  const expectedUser = env.ADMIN_USERNAME;
  const expectedPassword = env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword) return false;
  if (!authorization?.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return false;
  }
  const colon = decoded.indexOf(":"); // 비밀번호에는 ":"가 들어갈 수 있으므로 첫 ":"에서만 나눈다
  if (colon === -1) return false;

  // 둘 다 비교한다(앞에서 실패해도 바로 끝내지 않는다). 어느 쪽이 틀렸는지 응답 시간으로 드러나지 않게 하기 위해서다
  const userOk = safeEqual(decoded.slice(0, colon), expectedUser);
  const passwordOk = safeEqual(decoded.slice(colon + 1), expectedPassword);
  return userOk && passwordOk;
}

// timingSafeEqual은 길이가 같아야 하므로 해시로 길이를 맞춘다. 문자열을 그대로 비교하면 일치하는 앞부분 길이에 따라 시간이 달라진다
function safeEqual(actual: string, expected: string): boolean {
  const a = createHash("sha256").update(actual).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
