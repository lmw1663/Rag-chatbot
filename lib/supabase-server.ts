// 서버 전용 Supabase 클라이언트. secret 키(service_role)를 쓰므로 RLS를 우회한다.
// API 라우트와 scripts/에서만 import한다. 브라우저 번들에 들어가면 안 된다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// 처음 호출할 때 만든다. scripts/는 import 이후에 .env.local을 읽기 때문에, 모듈 로드 시점에 env를 읽지 않는다.
export function getSupabaseServer(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("getSupabaseServer는 서버에서만 호출할 수 있습니다");
  }
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SECRET_KEY가 설정되지 않았습니다 (.env.local 확인)");
  }

  client = createClient(url, secretKey, {
    // 사용자 로그인 세션이 없는 서버 클라이언트라 세션 저장과 토큰 갱신을 끈다.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
