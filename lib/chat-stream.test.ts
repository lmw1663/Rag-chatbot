import { describe, expect, it } from "vitest";
import type { PromptSource } from "./build-prompt";
import { citedSources, readChatStream, retrievedDocuments, type ChatStreamEvent } from "./chat-stream";

// 문자열 조각들을 네트워크에서 받은 것처럼 바이트 스트림으로 만든다
function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of readChatStream(stream)) events.push(event);
  return events;
}

describe("readChatStream", () => {
  it("한 줄이 여러 조각으로 잘려 와도 이어 붙여서 읽는다", async () => {
    const events = await collect(streamOf(['{"type":"te', 'xt","text":"지각"}\n{"type":"do', 'ne","answered":true,"saved":true}\n']));
    expect(events).toEqual([
      { type: "text", text: "지각" },
      { type: "done", answered: true, saved: true },
    ]);
  });

  it("한글 한 글자의 바이트가 조각 경계에서 잘려도 깨지지 않는다", async () => {
    const bytes = new TextEncoder().encode('{"type":"text","text":"근태"}\n');
    const cut = 24; // "근"(3바이트) 중간
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual([{ type: "text", text: "근태" }]);
  });

  it("마지막 줄에 줄바꿈이 없어도 읽고, 빈 줄은 건너뛴다", async () => {
    const events = await collect(streamOf(['{"type":"text","text":"a"}\n\n', '{"type":"done","answered":false,"saved":true}']));
    expect(events).toEqual([
      { type: "text", text: "a" },
      { type: "done", answered: false, saved: true },
    ]);
  });
});

describe("citedSources", () => {
  const sources: PromptSource[] = [1, 2, 3].map((index) => ({
    index,
    chunkId: 100 + index,
    slug: "attendance",
    title: "근태",
    heading: `헤딩${index}`,
  }));

  it("답변에 인용된 번호의 출처만 번호순으로, 중복 없이 돌려준다", () => {
    expect(citedSources("먼저 연락한다 [3]. 기록한다 [1][3].", sources).map((s) => s.index)).toEqual([1, 3]);
  });

  it("없는 번호나 인용이 없는 답변은 빈 배열이 된다", () => {
    expect(citedSources("매뉴얼에 없음 [9]", sources)).toEqual([]);
    expect(citedSources("매뉴얼에 없음", sources)).toEqual([]);
  });
});

describe("retrievedDocuments", () => {
  it("같은 문서의 청크는 한 번만, 검색 순위 순으로 돌려준다", () => {
    const sources: PromptSource[] = [
      { index: 1, chunkId: 101, slug: "attendance", title: "근태", heading: "지각" },
      { index: 2, chunkId: 109, slug: "complaint-handling", title: "컴플레인 응대", heading: "기본 태도" },
      { index: 3, chunkId: 102, slug: "attendance", title: "근태", heading: "결근" },
    ];
    expect(retrievedDocuments(sources)).toEqual([
      { slug: "attendance", title: "근태" },
      { slug: "complaint-handling", title: "컴플레인 응대" },
    ]);
  });
});
