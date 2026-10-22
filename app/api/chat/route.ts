// POST /api/chat: 질문 → 검색 → 프롬프트 조립 → Claude 스트리밍 → queries 로그 저장
//
// 응답은 NDJSON(줄마다 JSON 하나)이다. 출처 제목에 한글이 들어가 HTTP 헤더로 보낼 수 없어서 스트림 첫 줄로 보낸다.
//   {"type":"meta","queryId":"...","sources":[...]}   ← 맨 처음 1번
//   {"type":"text","text":"..."}                       ← 답변 조각, 여러 번
//   {"type":"done","answered":true,"saved":true}       ← 정상 종료. saved: queries 저장 성공 여부
//   {"type":"error","message":"..."}                   ← 도중 실패
import { z } from "zod";
import { buildPrompt, PROMPT_VERSION } from "@/lib/build-prompt";
import { MAX_QUESTION_LENGTH, type ChatStreamEvent } from "@/lib/chat-stream";
import { generateAnswer, type GeneratedAnswer } from "@/lib/generate-answer";
import { checkGlobalRateLimit, checkIpRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { searchChunks, type SearchResult } from "@/lib/search";
import { getSupabaseServer } from "@/lib/supabase-server";

const requestSchema = z.object(
  {
    question: z
      .string("질문은 문자열이어야 합니다")
      .trim()
      .min(1, "질문을 입력해 주세요")
      .max(MAX_QUESTION_LENGTH, `질문은 ${MAX_QUESTION_LENGTH}자 이하로 입력해 주세요`),
  },
  "요청 본문은 { question } 형태의 JSON이어야 합니다", // JSON이 아니거나 객체가 아닐 때
);

export async function POST(request: Request) {
  const startedAt = Date.now();

  const body: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "잘못된 요청입니다" }, { status: 400 });
  }
  const { question } = parsed.data;

  // 요청 횟수 제한은 검색(Voyage 임베딩)보다 먼저 한다. 검색부터 비용이 든다
  const ipLimit = checkIpRateLimit(`chat:${clientIp(request)}`); // API마다 따로 센다
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfterSec);
  const globalLimit = await checkGlobalRateLimit();
  if (!globalLimit.ok) return tooManyRequests(globalLimit.retryAfterSec);

  // 검색 실패(임베딩 API, DB 오류)는 스트림을 열기 전이라 500으로 바로 돌려준다
  let results: SearchResult[];
  try {
    results = await searchChunks(question);
  } catch (error) {
    console.error("[chat] 검색 실패", error);
    return Response.json({ error: "검색 중 오류가 발생했습니다" }, { status: 500 });
  }

  // 피드백 버튼이 쓸 id. 저장은 답변이 끝난 뒤에 하므로 미리 만들어 meta로 먼저 보낸다
  const queryId = crypto.randomUUID();
  const prompt = buildPrompt(question, results);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 사용자가 도중에 연결을 끊으면 enqueue가 에러를 던진다. 그래도 아래의 로그 저장까지는 가야 하므로 무시한다
      let closed = false;
      const send = (event: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      send({ type: "meta", queryId, sources: prompt.sources });

      let result: GeneratedAnswer | null = null; // null이면 실패(API 오류, 사용자 중단)
      try {
        result = await generateAnswer(prompt, {
          signal: request.signal, // 사용자가 창을 닫으면 Claude 요청도 끊는다
          onText: (text) => send({ type: "text", text }),
        });
      } catch (error) {
        console.error("[chat] 답변 생성 실패", error);
        send({ type: "error", message: "답변 생성 중 오류가 발생했습니다" });
      }

      // answered = false는 세 경우다. answer로 구분한다(CLAUDE.md "데이터 의미" 참고)
      //   매뉴얼에 없음: answer = "매뉴얼에 없음" / 거절: answer = 거절 안내 포함 / 실패·중단: answer = null
      const saved = await saveQuery({
        queryId,
        question,
        answer: result?.answer ?? null,
        answered: result?.answered ?? false,
        model: result?.model ?? null,
        results,
        latencyMs: Date.now() - startedAt,
      });

      if (result) send({ type: "done", answered: result.answered, saved });
      if (!closed) controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

type SaveQueryInput = {
  queryId: string;
  question: string;
  answer: string | null;
  answered: boolean;
  model: string | null; // LLM을 부르지 않았거나 실패했으면 null
  results: SearchResult[];
  latencyMs: number;
};

// 로그 저장이 실패해도 사용자는 이미 답변을 받았으므로 에러를 던지지 않는다.
// 대신 성공 여부를 돌려줘서, 저장되지 않은 답변에는 피드백 버튼을 띄우지 않게 한다(눌러도 404가 되므로)
async function saveQuery({ queryId, question, answer, answered, model, results, latencyMs }: SaveQueryInput): Promise<boolean> {
  const { error } = await getSupabaseServer()
    .from("queries")
    .insert({
      id: queryId,
      question,
      answer,
      answered,
      model,
      prompt_version: PROMPT_VERSION,
      latency_ms: latencyMs,
      top_similarity: results.length === 0 ? null : Math.max(...results.map((r) => r.similarity)),
      // 재인제스트하면 청크 id가 바뀌므로 id 대신 slug와 헤딩을 스냅샷으로 남긴다
      retrieved_chunks: results.map((r) => ({ slug: r.slug, heading: r.heading, similarity: r.similarity })),
    });
  if (error) {
    console.error("[chat] queries 저장 실패", error);
    return false;
  }
  return true;
}
