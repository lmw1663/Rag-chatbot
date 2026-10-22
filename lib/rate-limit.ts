// 요청 횟수 제한. 공개 URL에서 반복 호출로 API 크레딧(Claude, Voyage)이 바닥나는 것을 막는다.
// 두 단계로 막는다.
//   1. IP별 제한 (메모리): 한 사람이 연달아 보내는 것을 줄인다. 최선 노력이다 —
//      Vercel 서버리스는 인스턴스가 여러 개이고 수시로 새로 뜨므로, 인스턴스마다 따로 세고 재시작하면 초기화된다.
//   2. 전체 사용량 상한 (DB): queries 로그로 최근 1분, 24시간 질문 수를 센다. 인스턴스와 상관없이 전체 비용의 상한이 된다.
//      로그는 답변이 끝난 뒤 저장되므로, 동시에 들어온 요청은 몇 개 더 통과할 수 있다(느슨한 상한).
import { getSupabaseServer } from "./supabase-server";

export const IP_LIMIT = { limit: 10, windowMs: 60_000 }; // IP당 1분 10회
export const GLOBAL_LIMITS = [
  { limit: 30, windowMs: 60_000 }, // 전체 1분 30회
  { limit: 500, windowMs: 24 * 60 * 60_000 }, // 전체 24시간 500회 (Haiku 기준 하루 약 $0.25)
];

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

type Window = { limit: number; windowMs: number };

// IP → 최근 요청 시각들. 오래된 시각은 확인할 때마다 지운다
export type IpStore = Map<string, number[]>;
const MAX_TRACKED_IPS = 10_000; // 메모리가 끝없이 늘지 않게 하는 상한

const defaultStore: IpStore = new Map();

// 슬라이딩 윈도: 지금부터 windowMs 안의 요청 수가 limit 이상이면 막는다. 막힌 요청은 세지 않는다.
export function checkIpRateLimit(
  ip: string,
  { limit, windowMs }: Window = IP_LIMIT,
  now = Date.now(),
  store: IpStore = defaultStore,
): RateLimitResult {
  const recent = (store.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    store.set(ip, recent);
    // 가장 오래된 요청이 윈도를 벗어나는 시각까지 기다리면 된다
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
  }
  recent.push(now);
  store.set(ip, recent);
  if (store.size > MAX_TRACKED_IPS) {
    // Map은 넣은 순서를 기억하므로 첫 키가 가장 오래전에 처음 본 IP다
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  return { ok: true };
}

// DB 조회가 실패하면 막지 않는다(fail-open). 상한 확인 때문에 서비스 전체가 멈추는 것보다 낫고, IP 제한은 그대로 동작한다.
export async function checkGlobalRateLimit(now = Date.now()): Promise<RateLimitResult> {
  const supabase = getSupabaseServer();
  const counts = await Promise.all(
    GLOBAL_LIMITS.map(({ windowMs }) =>
      supabase
        .from("queries")
        .select("id", { count: "exact", head: true }) // 행은 가져오지 않고 개수만 센다
        .gte("created_at", new Date(now - windowMs).toISOString()),
    ),
  );
  for (const [i, { count, error }] of counts.entries()) {
    if (error) {
      console.error("[rate-limit] 전체 사용량 조회 실패", error);
      return { ok: true };
    }
    if ((count ?? 0) >= GLOBAL_LIMITS[i].limit) {
      // 정확한 해제 시각을 계산하려면 행을 더 읽어야 해서, 1분 상한이면 60초, 24시간 상한이면 1시간 뒤로 안내한다
      return { ok: false, retryAfterSec: GLOBAL_LIMITS[i].windowMs <= 60_000 ? 60 : 3600 };
    }
  }
  return { ok: true };
}

// Vercel은 x-real-ip, x-forwarded-for에 실제 클라이언트 IP를 넣고 클라이언트가 보낸 값을 덮어쓴다.
// Vercel 밖(로컬 등)에서는 클라이언트가 이 헤더를 위조할 수 있다. IP 제한을 최선 노력으로 보는 이유 중 하나다.
export function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function tooManyRequests(retryAfterSec: number): Response {
  return Response.json(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
