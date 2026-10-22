// Voyage 임베딩 API 호출. SDK 없이 REST를 fetch로 직접 부른다.
// input_type: 매뉴얼 청크는 "document", 사용자 질문은 "query". 둘을 섞으면 에러 없이 검색 품질만 떨어진다.

export const EMBEDDING_MODEL = "voyage-4";
export const EMBEDDING_DIMENSIONS = 1024; // chunks.embedding vector(1024)와 같아야 한다

export type EmbeddingInputType = "document" | "query";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const BATCH_SIZE = 128; // 한 요청에 보내는 텍스트 수. API 한도보다 작게 잡았다

// 재시도 정책은 호출하는 쪽의 성격에 따라 다르다.
//   일괄 작업(인제스트): 분 단위 한도가 풀릴 때까지 오래 기다려도 된다.
//   사용자가 기다리는 요청(/api/chat의 질문 임베딩): 몇 분씩 기다리게 할 수 없으므로 한 번만 짧게 다시 시도한다.
export type RetryPolicy = { maxAttempts: number; maxDelayMs: number };
export const BATCH_RETRY: RetryPolicy = { maxAttempts: 5, maxDelayMs: 60_000 };
export const INTERACTIVE_RETRY: RetryPolicy = { maxAttempts: 2, maxDelayMs: 2_000 };

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
};

// 텍스트 배열을 받아 같은 순서의 벡터 배열을 돌려준다.
export async function embedTexts(
  texts: string[],
  inputType: EmbeddingInputType,
  retry: RetryPolicy = BATCH_RETRY,
): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    embeddings.push(...(await embedBatch(batch, inputType, retry)));
  }
  return embeddings;
}

export async function embedQuery(question: string): Promise<number[]> {
  const [embedding] = await embedTexts([question], "query", INTERACTIVE_RETRY);
  return embedding;
}

async function embedBatch(texts: string[], inputType: EmbeddingInputType, retry: RetryPolicy): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY가 설정되지 않았습니다 (.env.local 확인)");

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: texts,
        model: EMBEDDING_MODEL,
        input_type: inputType,
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    });

    // 429(요청 한도)와 5xx(서버 오류)는 잠시 기다렸다 다시 시도한다. 그 외 오류는 바로 실패한다.
    const retryable = response.status === 429 || response.status >= 500;
    if (!response.ok) {
      if (retryable && attempt < retry.maxAttempts) {
        const delayMs = retryDelayMs(response.status, response.headers.get("retry-after"), attempt, retry.maxDelayMs);
        console.warn(`Voyage ${response.status}: ${Math.round(delayMs / 1000)}초 뒤 다시 시도 (${attempt}/${retry.maxAttempts - 1})`);
        await sleep(delayMs);
        continue;
      }
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Voyage 임베딩 요청 실패 (${response.status}): ${detail}`);
    }

    const { data } = (await response.json()) as VoyageResponse;
    return toOrderedEmbeddings(data, texts.length);
  }
}

// 재시도 전 대기 시간. Voyage 한도는 분 단위(분당 요청 수, 분당 토큰 수)라 1~2초 기다려서는 풀리지 않는다.
//   - Retry-After 헤더가 있으면 그대로 따른다(초 또는 HTTP 날짜).
//   - 없으면 429는 20초, 40초, 60초로 늘리고, 5xx는 1초, 2초, 4초로 짧게 기다린다.
//   - 어느 경우든 1초 ~ maxDelayMs로 자른다(인제스트 60초, 질문 임베딩 2초).
export function retryDelayMs(
  status: number,
  retryAfter: string | null,
  attempt: number,
  maxDelayMs = BATCH_RETRY.maxDelayMs,
  now = Date.now(),
): number {
  const fromHeader = parseRetryAfter(retryAfter, now);
  const fallback = status === 429 ? 20_000 * attempt : 1000 * 2 ** (attempt - 1);
  return Math.min(Math.max(fromHeader ?? fallback, 1000), maxDelayMs);
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : date - now;
}

// 응답을 입력 순서대로 정렬하고, 개수와 차원을 확인한다. 어긋나면 DB에 넣기 전에 여기서 실패시킨다.
function toOrderedEmbeddings(data: VoyageResponse["data"], expectedCount: number): number[][] {
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new Error(`Voyage 응답 개수가 다릅니다: 기대 ${expectedCount}, 실제 ${data?.length}`);
  }
  const ordered = [...data].sort((a, b) => a.index - b.index);
  for (const item of ordered) {
    if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`임베딩 차원이 다릅니다: 기대 ${EMBEDDING_DIMENSIONS}, 실제 ${item.embedding.length}`);
    }
  }
  return ordered.map((item) => item.embedding);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
