// /api/chat 응답 스트림(NDJSON)의 형식과, 브라우저에서 그것을 읽는 함수. 서버와 클라이언트가 같이 쓴다.
// 비밀 값을 쓰는 모듈은 import하지 않는다(브라우저 번들에 들어가므로). PromptSource는 타입만 가져온다.
import type { PromptSource } from "./build-prompt";

// 질문 최대 길이. 서버 zod 검증과 입력창 maxLength가 같이 쓴다(최종 검증은 서버)
export const MAX_QUESTION_LENGTH = 500;

export type ChatStreamEvent =
  | { type: "meta"; queryId: string; sources: PromptSource[] } // 맨 처음 1번
  | { type: "text"; text: string } // 답변 조각
  | { type: "done"; answered: boolean; saved: boolean } // 정상 종료. saved = false면 queries 행이 없어 피드백을 받을 수 없다
  | { type: "error"; message: string }; // 도중 실패

// 네트워크 조각은 줄 경계와 상관없이 잘려서 온다. 마지막 줄바꿈 뒤의 미완성 줄은 다음 조각과 합쳐서 읽는다.
export async function* readChatStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  // stream: true면 조각 끝에서 잘린 한글 바이트(UTF-8 3바이트)를 들고 있다가 다음 조각과 합쳐 해석한다
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as ChatStreamEvent;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as ChatStreamEvent;
}

// 답변에 [n]으로 실제 인용된 출처만 번호순으로 돌려준다. 검색됐지만 답변에 안 쓰인 청크는 출처로 보여 주지 않는다.
export function citedSources(answer: string, sources: PromptSource[]): PromptSource[] {
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
  return sources.filter((source) => cited.has(source.index));
}

// 모델이 [n] 표시를 빠뜨렸을 때 쓰는 대체 출처: 검색된 문서를 제목 기준으로 한 번씩, 검색 순위 순으로 돌려준다.
// 어느 청크를 썼는지는 모르므로 헤딩은 빼고 문서 단위로만 보여 준다.
export function retrievedDocuments(sources: PromptSource[]): { slug: string; title: string }[] {
  const seen = new Set<string>();
  const documents: { slug: string; title: string }[] = [];
  for (const source of sources) {
    if (seen.has(source.slug)) continue;
    seen.add(source.slug);
    documents.push({ slug: source.slug, title: source.title });
  }
  return documents;
}
