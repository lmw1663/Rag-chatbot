// Voyage 임베딩 API 호출. SDK 없이 REST를 fetch로 직접 부른다.
// input_type: 매뉴얼 청크는 "document", 사용자 질문은 "query". 둘을 섞으면 에러 없이 검색 품질만 떨어진다.

export const EMBEDDING_MODEL = "voyage-4";
export const EMBEDDING_DIMENSIONS = 1024; // chunks.embedding vector(1024)와 같아야 한다

export type EmbeddingInputType = "document" | "query";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const BATCH_SIZE = 128; // 한 요청에 보내는 텍스트 수. API 한도보다 작게 잡았다
const MAX_ATTEMPTS = 3;

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
};

// 텍스트 배열을 받아 같은 순서의 벡터 배열을 돌려준다.
export async function embedTexts(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    embeddings.push(...(await embedBatch(batch, inputType)));
  }
  return embeddings;
}

export async function embedQuery(question: string): Promise<number[]> {
  const [embedding] = await embedTexts([question], "query");
  return embedding;
}

async function embedBatch(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
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
      if (retryable && attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Voyage 임베딩 요청 실패 (${response.status}): ${detail}`);
    }

    const { data } = (await response.json()) as VoyageResponse;
    return toOrderedEmbeddings(data, texts.length);
  }
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
