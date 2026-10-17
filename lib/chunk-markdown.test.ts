import { describe, expect, it } from "vitest";
import { chunkMarkdown, MAX_CHUNK_CHARS } from "./chunk-markdown";

// content = "접두어\n본문" 형태라서 첫 줄(접두어)을 떼면 본문이 된다.
function bodyOf(content: string): string {
  return content.slice(content.indexOf("\n") + 1);
}

describe("chunkMarkdown: 헤딩 기준 분할", () => {
  it("첫 H1을 제목으로 쓰고, 헤딩마다 청크를 만들며 접두어를 붙인다", () => {
    const md = ["# 마감 매뉴얼", "", "## 프라이어 청소", "전원을 끈다.", "", "## 재고 실사", "수량을 센다."].join("\n");

    const { title, chunks } = chunkMarkdown(md);

    expect(title).toBe("마감 매뉴얼");
    expect(chunks).toEqual([
      { chunkIndex: 0, heading: "프라이어 청소", content: "마감 매뉴얼 > 프라이어 청소\n전원을 끈다." },
      { chunkIndex: 1, heading: "재고 실사", content: "마감 매뉴얼 > 재고 실사\n수량을 센다." },
    ]);
  });

  it("H3는 상위 H2 경로를 포함하고, 다음 H2가 나오면 경로가 바뀐다", () => {
    const md = ["# 문서", "## 재고", "### 실사", "센다.", "### 폐기", "버린다.", "## 위생", "손을 씻는다."].join("\n");

    const headings = chunkMarkdown(md).chunks.map((c) => c.heading);

    expect(headings).toEqual(["재고 > 실사", "재고 > 폐기", "위생"]);
  });

  it("본문이 없는 섹션은 청크를 만들지 않는다", () => {
    const md = ["# 문서", "## 재고", "", "### 실사", "센다."].join("\n");

    const { chunks } = chunkMarkdown(md);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe("재고 > 실사");
  });

  it("첫 헤딩 전의 본문은 heading이 null이고 접두어는 제목만 붙는다", () => {
    const md = ["# 오픈 매뉴얼", "개점 준비 절차다.", "## 해동", "전날 옮겨 둔다."].join("\n");

    const [intro] = chunkMarkdown(md).chunks;

    expect(intro).toEqual({ chunkIndex: 0, heading: null, content: "오픈 매뉴얼\n개점 준비 절차다." });
  });

  it("H1이 없으면 title은 null이고 접두어는 헤딩 경로만 붙는다", () => {
    const { title, chunks } = chunkMarkdown("## 해동\n전날 옮겨 둔다.");

    expect(title).toBeNull();
    expect(chunks[0].content).toBe("해동\n전날 옮겨 둔다.");
  });

  it("두 번째 H1부터는 제목이 아니라 섹션 헤딩으로 쓴다", () => {
    const md = ["# 제목", "## 하위", "가.", "# 두 번째", "나."].join("\n");

    const { title, chunks } = chunkMarkdown(md);

    expect(title).toBe("제목");
    expect(chunks.map((c) => c.heading)).toEqual(["하위", "두 번째"]);
  });

  it("H4 이하는 섹션을 나누지 않고 본문에 남는다", () => {
    const { chunks } = chunkMarkdown("# 문서\n## 해동\n#### 주의\n상온 해동 금지.");

    expect(chunks).toHaveLength(1);
    expect(bodyOf(chunks[0].content)).toBe("#### 주의\n상온 해동 금지.");
  });

  it("코드 블록 안의 '#'은 헤딩으로 보지 않는다", () => {
    const md = ["# 문서", "## 예시", "```", "# 주석", "```"].join("\n");

    const { chunks } = chunkMarkdown(md);

    expect(chunks).toHaveLength(1);
    expect(bodyOf(chunks[0].content)).toBe("```\n# 주석\n```");
  });

  it("CRLF 줄바꿈도 LF와 같은 결과를 낸다", () => {
    const lf = "# 문서\n## 해동\n전날 옮긴다.\n\n두 번째 문단.";

    expect(chunkMarkdown(lf.replace(/\n/g, "\r\n"))).toEqual(chunkMarkdown(lf));
  });
});

describe("chunkMarkdown: 길이 제한", () => {
  it("기본 최대 길이는 800자다", () => {
    expect(MAX_CHUNK_CHARS).toBe(800);
  });

  it("최대 길이를 넘는 섹션은 문단 단위로 나누고, 같은 heading과 연속 chunkIndex를 가진다", () => {
    const paragraphs = ["가".repeat(8), "나".repeat(8), "다".repeat(8)];
    const md = `# 문서\n## 섹션\n${paragraphs.join("\n\n")}`;

    const { chunks } = chunkMarkdown(md, 20);

    expect(chunks.map((c) => bodyOf(c.content))).toEqual([`${paragraphs[0]}\n\n${paragraphs[1]}`, paragraphs[2]]);
    expect(chunks.map((c) => c.heading)).toEqual(["섹션", "섹션"]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it("최대 길이는 본문 기준이며 접두어는 길이에 포함하지 않는다", () => {
    const md = `# 아주 긴 문서 제목입니다\n## 아주 긴 섹션 제목입니다\n${"가".repeat(10)}`;

    const [chunk] = chunkMarkdown(md, 10).chunks;

    expect(bodyOf(chunk.content)).toBe("가".repeat(10));
    expect(chunk.content.length).toBeGreaterThan(10);
  });

  it("문단 하나가 길면 줄 단위로 나누고, 줄 중간은 자르지 않는다", () => {
    const steps = ["1. 전원을 끈다.", "2. 오일을 식힌다.", "3. 필터를 뺀다."];
    const md = `# 문서\n## 프라이어 청소\n${steps.join("\n")}`;

    const bodies = chunkMarkdown(md, 25).chunks.map((c) => bodyOf(c.content));

    expect(bodies).toEqual([`${steps[0]}\n${steps[1]}`, steps[2]]);
  });

  it("줄바꿈 없는 긴 줄은 글자 단위로 자르고 모든 조각이 최대 길이 이하다", () => {
    const line = "가".repeat(25);

    const bodies = chunkMarkdown(`## 섹션\n${line}`, 10).chunks.map((c) => bodyOf(c.content));

    expect(bodies).toEqual(["가".repeat(10), "가".repeat(10), "가".repeat(5)]);
  });

  it("글자 단위로 자를 때 이모지가 반으로 갈리지 않는다", () => {
    const line = "😀".repeat(5); // 이모지 1개 = string.length 2

    const bodies = chunkMarkdown(`## 섹션\n${line}`, 3).chunks.map((c) => bodyOf(c.content));

    expect(bodies).toEqual(Array(5).fill("😀"));
    expect(bodies.join("")).toBe(line);
  });

  it("maxChars가 1 이상의 정수가 아니면 에러를 던진다", () => {
    expect(() => chunkMarkdown("본문", 0)).toThrow();
    expect(() => chunkMarkdown("본문", 1.5)).toThrow();
  });
});

describe("chunkMarkdown: 결정성", () => {
  it("같은 입력은 항상 같은 결과를 낸다", () => {
    const md = `# 문서\n## 섹션\n${"가".repeat(30)}\n\n${"나".repeat(30)}\n## 다음\n끝.`;

    expect(chunkMarkdown(md, 20)).toEqual(chunkMarkdown(md, 20));
  });

  it("빈 문서는 청크가 없다", () => {
    expect(chunkMarkdown("")).toEqual({ title: null, category: null, chunks: [] });
  });
});

describe("chunkMarkdown: frontmatter", () => {
  it("frontmatter의 title, category를 읽고, frontmatter 자체는 청크에 넣지 않는다", () => {
    const md = ["---", "title: 튀김기 기름 관리", "category: 기기", "---", "# 튀김기 기름 관리", "", "## 교체 순서", "전원을 끈다."].join("\n");

    expect(chunkMarkdown(md)).toEqual({
      title: "튀김기 기름 관리",
      category: "기기",
      chunks: [{ chunkIndex: 0, heading: "교체 순서", content: "튀김기 기름 관리 > 교체 순서\n전원을 끈다." }],
    });
  });

  it("frontmatter title이 H1보다 우선하고, H1은 섹션을 만들지 않는다", () => {
    const md = ["---", "title: 메타 제목", "---", "# 본문 제목", "## 섹션", "내용."].join("\n");

    const { title, chunks } = chunkMarkdown(md);

    expect(title).toBe("메타 제목");
    expect(chunks.map((c) => c.content)).toEqual(["메타 제목 > 섹션\n내용."]);
  });

  it("frontmatter에 title이 없으면 H1을 쓰고, category가 없으면 null이다", () => {
    const md = ["---", "author: 크루", "---", "# 본문 제목", "## 섹션", "내용."].join("\n");

    const { title, category } = chunkMarkdown(md);

    expect(title).toBe("본문 제목");
    expect(category).toBeNull();
  });

  it("값을 감싼 따옴표는 벗기고, 빈 값은 없는 것으로 본다", () => {
    const md = ["---", 'title: "따옴표 제목"', "category:", "---", "## 섹션", "내용."].join("\n");

    const { title, category } = chunkMarkdown(md);

    expect(title).toBe("따옴표 제목");
    expect(category).toBeNull();
  });

  it("문서 맨 앞이 아닌 '---'(구분선)는 frontmatter로 보지 않는다", () => {
    const md = ["# 문서", "## 섹션", "위", "---", "category: 기기", "---", "아래"].join("\n");

    const { category, chunks } = chunkMarkdown(md);

    expect(category).toBeNull();
    expect(bodyOf(chunks[0].content)).toBe("위\n---\ncategory: 기기\n---\n아래");
  });

  it("CRLF 줄바꿈의 frontmatter도 읽는다", () => {
    const md = ["---", "title: 제목", "category: 위생", "---", "## 섹션", "내용."].join("\r\n");

    const { title, category, chunks } = chunkMarkdown(md);

    expect([title, category]).toEqual(["제목", "위생"]);
    expect(chunks).toHaveLength(1);
  });
});
