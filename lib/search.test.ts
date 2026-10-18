import { describe, expect, it } from "vitest";
import { toSearchResults, type SearchChunksRow } from "./search";

const row: SearchChunksRow = {
  chunk_id: 101,
  slug: "attendance",
  title: "근태",
  heading: "지각할 것 같을 때",
  content: "근태 > 지각할 것 같을 때\n- 매니저에게 먼저 연락한다.",
  similarity: 0.42,
  keyword_score: 0.17,
  rrf_score: 0.032,
};

describe("toSearchResults", () => {
  it("DB 컬럼 이름을 camelCase 필드로 바꾸고 순서를 유지한다", () => {
    const second = { ...row, chunk_id: 102, heading: null };
    expect(toSearchResults([row, second])).toEqual([
      {
        chunkId: 101,
        slug: "attendance",
        title: "근태",
        heading: "지각할 것 같을 때",
        content: row.content,
        similarity: 0.42,
        keywordScore: 0.17,
        rrfScore: 0.032,
      },
      expect.objectContaining({ chunkId: 102, heading: null }),
    ]);
  });

  it("검색 결과가 없으면 빈 배열을 돌려준다", () => {
    expect(toSearchResults([])).toEqual([]);
  });
});
