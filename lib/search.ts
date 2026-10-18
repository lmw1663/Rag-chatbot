// 질문으로 매뉴얼 청크를 찾는다. 질문 임베딩 → DB의 혼합 검색 함수(search_chunks: 벡터 + 키워드, RRF)를 호출한다.
// 서버 전용: secret 키를 쓰는 Supabase 클라이언트와 Voyage 키를 쓴다.
import { embedQuery } from "./embed";
import { getSupabaseServer } from "./supabase-server";

export type SearchResult = {
  chunkId: number;
  slug: string;
  title: string; // 출처 표시에 쓰는 문서 제목
  heading: string | null;
  content: string;
  similarity: number; // 코사인 유사도
  keywordScore: number; // trigram word_similarity
  rrfScore: number;
};

// search_chunks가 돌려주는 행 (DB 컬럼 이름 그대로)
export type SearchChunksRow = {
  chunk_id: number;
  slug: string;
  title: string;
  heading: string | null;
  content: string;
  similarity: number;
  keyword_score: number;
  rrf_score: number;
};

export const DEFAULT_MATCH_COUNT = 5;

// 결과가 빈 배열이면 매뉴얼에 관련 청크가 없다는 뜻이다. "매뉴얼에 없음" 처리는 호출하는 쪽에서 한다.
export async function searchChunks(question: string, matchCount = DEFAULT_MATCH_COUNT): Promise<SearchResult[]> {
  const embedding = await embedQuery(question);

  const { data, error } = await getSupabaseServer().rpc("search_chunks", {
    p_query_text: question,
    p_query_embedding: embedding,
    p_match_count: matchCount,
  });
  if (error) throw new Error(`청크 검색 실패: ${error.message}`);

  return toSearchResults(data ?? []);
}

export function toSearchResults(rows: SearchChunksRow[]): SearchResult[] {
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    slug: row.slug,
    title: row.title,
    heading: row.heading,
    content: row.content,
    similarity: row.similarity,
    keywordScore: row.keyword_score,
    rrfScore: row.rrf_score,
  }));
}
