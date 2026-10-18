"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { readChatStream } from "@/lib/chat-stream";
import { ChatMessage, type ChatTurn } from "./ChatMessage";

const MAX_QUESTION_LENGTH = 500; // 서버(app/api/chat/route.ts)의 zod 검증과 같은 값. 최종 검증은 서버가 한다

export default function Home() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 답변이 늘어날 때마다 맨 아래로 스크롤한다
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  function updateTurn(id: string, patch: (turn: ChatTurn) => Partial<ChatTurn>) {
    setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, ...patch(turn) } : turn)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || pending) return;

    const id = crypto.randomUUID();
    setTurns((prev) => [
      ...prev,
      {
        id,
        question,
        answer: "",
        sources: [],
        queryId: null,
        status: "streaming",
        answered: null,
        errorMessage: null,
        rating: null,
        feedbackError: null,
      },
    ]);
    setInput("");
    setPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      // 400(입력 검증)과 500(검색 실패)은 스트림이 아니라 { error } JSON으로 온다
      if (!response.ok || !response.body) {
        const { error } = (await response.json().catch(() => ({}))) as { error?: string };
        updateTurn(id, () => ({ status: "error", errorMessage: error ?? "요청에 실패했습니다" }));
        return;
      }

      let finished = false; // done 또는 error를 받았는지
      for await (const streamEvent of readChatStream(response.body)) {
        if (streamEvent.type === "done" || streamEvent.type === "error") finished = true;
        switch (streamEvent.type) {
          case "meta":
            updateTurn(id, () => ({ queryId: streamEvent.queryId, sources: streamEvent.sources }));
            break;
          case "text":
            updateTurn(id, (turn) => ({ answer: turn.answer + streamEvent.text }));
            break;
          case "done":
            updateTurn(id, () => ({ status: "done", answered: streamEvent.answered }));
            break;
          case "error":
            updateTurn(id, () => ({ status: "error", errorMessage: streamEvent.message }));
            break;
        }
      }
      // 서버가 done 없이 연결을 끊으면(타임아웃, 서버 재시작) "찾는 중"에 멈춰 있지 않게 에러로 바꾼다
      if (!finished) {
        updateTurn(id, () => ({ status: "error", errorMessage: "답변이 중간에 끊겼습니다" }));
      }
    } catch {
      updateTurn(id, () => ({ status: "error", errorMessage: "네트워크 오류가 발생했습니다" }));
    } finally {
      setPending(false);
    }
  }

  // 서버 저장이 성공한 뒤에 버튼 상태를 바꾼다. 실패했는데 눌린 것처럼 보이면 사용자는 저장된 줄 안다
  async function handleFeedback(turn: ChatTurn, rating: 1 | -1) {
    if (!turn.queryId) return;
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId: turn.queryId, rating }),
      });
      if (!response.ok) {
        const { error } = (await response.json().catch(() => ({}))) as { error?: string };
        updateTurn(turn.id, () => ({ feedbackError: error ?? "피드백 저장에 실패했습니다" }));
        return;
      }
      updateTurn(turn.id, () => ({ rating, feedbackError: null }));
    } catch {
      updateTurn(turn.id, () => ({ feedbackError: "네트워크 오류가 발생했습니다" }));
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="mx-auto max-w-3xl text-lg font-semibold">매장 업무 매뉴얼 챗봇</h1>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
        {turns.length === 0 && (
          <p className="text-zinc-500">매장 업무에 대해 물어보세요. 예: &ldquo;튀김기 기름은 언제 갈아요?&rdquo;</p>
        )}
        {turns.map((turn) => (
          <ChatMessage key={turn.id} turn={turn} onFeedback={(rating) => handleFeedback(turn, rating)} />
        ))}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={handleSubmit}
        className="sticky bottom-0 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="mx-auto flex max-w-3xl gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={MAX_QUESTION_LENGTH}
            placeholder="질문을 입력하세요"
            aria-label="질문"
            className="flex-1 rounded-xl border border-zinc-300 bg-transparent px-4 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "답변 중" : "보내기"}
          </button>
        </div>
      </form>
    </div>
  );
}
