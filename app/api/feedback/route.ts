// POST /api/feedback: 답변 하나에 👍(1) / 👎(-1)을 남긴다. 다시 누르면 기존 평가를 바꾼다(query_id 기준 upsert).
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase-server";

const requestSchema = z.object(
  {
    queryId: z.uuid("queryId 형식이 올바르지 않습니다"),
    rating: z.union([z.literal(1), z.literal(-1)], "rating은 1 또는 -1이어야 합니다"),
  },
  "요청 본문은 { queryId, rating } 형태의 JSON이어야 합니다",
);

// Postgres 외래키 위반 에러 코드. 없는 queryId로 피드백을 보내면 이 에러가 난다
const FOREIGN_KEY_VIOLATION = "23503";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "잘못된 요청입니다" }, { status: 400 });
  }
  const { queryId, rating } = parsed.data;

  const { error } = await getSupabaseServer()
    .from("feedback")
    .upsert({ query_id: queryId, rating }, { onConflict: "query_id" });

  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return Response.json({ error: "해당 답변을 찾을 수 없습니다" }, { status: 404 });
    }
    console.error("[feedback] 저장 실패", error);
    return Response.json({ error: "피드백 저장 중 오류가 발생했습니다" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
