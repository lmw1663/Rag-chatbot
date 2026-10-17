// 매뉴얼 마크다운을 헤딩 기준으로 잘라 청크로 만든다.
// - 첫 번째 H1은 문서 제목으로 쓰고, H1~H3가 나올 때마다 새 섹션을 시작한다. H4 이하는 본문으로 취급한다.
// - 섹션 본문이 maxChars를 넘으면 문단 → 줄 → 글자 순으로 나눈다.
// - 청크 본문 앞에 "문서 제목 > 헤딩 경로"를 붙여 임베딩에 문맥이 들어가게 한다.
// 같은 입력이면 항상 같은 결과를 낸다(재인제스트 시 chunk_index 안정성).

export const MAX_CHUNK_CHARS = 800;

export type Chunk = {
  chunkIndex: number;
  heading: string | null; // "마감 > 프라이어 청소" 같은 헤딩 경로. 첫 헤딩 전 본문이면 null
  content: string; // 임베딩·검색에 쓰는 텍스트(접두어 포함)
};

export type ChunkedDocument = {
  title: string | null; // 첫 번째 H1. 없으면 null (인제스트에서 파일명으로 대체)
  chunks: Chunk[];
};

type Section = { heading: string | null; lines: string[] };

const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const CODE_FENCE_PATTERN = /^\s*(```|~~~)/;

export function chunkMarkdown(
  markdown: string,
  maxChars: number = MAX_CHUNK_CHARS,
): ChunkedDocument {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new Error(`maxChars는 1 이상의 정수여야 합니다: ${maxChars}`);
  }

  const { title, sections } = splitSections(markdown);

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const body = section.lines.join("\n").trim();
    if (!body) continue; // 바로 하위 헤딩이 이어지는 등 본문이 없는 섹션

    const prefix = [title, section.heading].filter(Boolean).join(" > ");
    for (const piece of splitToFit(body, maxChars)) {
      chunks.push({
        chunkIndex: chunks.length,
        heading: section.heading,
        content: prefix ? `${prefix}\n${piece}` : piece,
      });
    }
  }

  return { title, chunks };
}

// 줄 단위로 훑으며 헤딩을 만날 때마다 섹션을 나눈다. 코드 블록 안의 '#'은 헤딩으로 보지 않는다.
function splitSections(markdown: string): { title: string | null; sections: Section[] } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  let title: string | null = null;
  const headingStack: { level: number; text: string }[] = [];
  const sections: Section[] = [{ heading: null, lines: [] }];
  let inCodeBlock = false;

  for (const line of lines) {
    if (CODE_FENCE_PATTERN.test(line)) inCodeBlock = !inCodeBlock;

    const match = inCodeBlock ? null : HEADING_PATTERN.exec(line);
    if (!match) {
      sections[sections.length - 1].lines.push(line);
      continue;
    }

    const level = match[1].length;
    const text = match[2];

    if (level === 1 && title === null) {
      title = text;
      continue;
    }

    // 같은 레벨 이상의 헤딩을 걷어내고 현재 헤딩을 쌓으면 상위 > 하위 경로가 된다.
    while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
      headingStack.pop();
    }
    headingStack.push({ level, text });
    sections.push({ heading: headingStack.map((h) => h.text).join(" > "), lines: [] });
  }

  return { title, sections };
}

// 본문을 maxChars 이하 조각으로 나눈다. 문단(빈 줄) → 줄 → 글자 순으로 더 잘게 나눈다.
function splitToFit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const paragraphs = text.split(/\n[ \t]*\n/).filter((p) => p.trim() !== "");
  if (paragraphs.length > 1) return pack(paragraphs, "\n\n", maxChars);

  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length > 1) return pack(lines, "\n", maxChars);

  return splitByChars(text, maxChars);
}

// 조각들을 순서대로 이어 붙이되, maxChars를 넘기 직전에 끊는다.
function pack(parts: string[], separator: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";

  for (const part of parts.flatMap((p) => splitToFit(p.trim(), maxChars))) {
    const candidate = current ? current + separator + part : part;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) pieces.push(current);
    current = part;
  }
  if (current) pieces.push(current);

  return pieces;
}

// 줄바꿈 없이 긴 한 줄은 글자 수로 자른다.
// 길이는 다른 곳과 같이 string.length로 재고, 문자 단위(Array.from)로 이어 붙여 이모지가 반으로 갈리지 않게 한다.
function splitByChars(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of Array.from(text)) {
    if (current && current.length + char.length > maxChars) {
      pieces.push(current);
      current = "";
    }
    current += char;
  }
  if (current) pieces.push(current);
  return pieces;
}
