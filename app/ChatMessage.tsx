import type { PromptSource } from "@/lib/build-prompt";
import { citedSources, retrievedDocuments } from "@/lib/chat-stream";

export type ChatTurn = {
  id: string; // 화면용 키. DB의 queryId와는 별개다
  question: string;
  answer: string;
  sources: PromptSource[]; // 검색된 청크 전체. 화면에는 답변에 인용된 것만 보여 준다
  queryId: string | null; // meta를 받으면 채워진다. 피드백 버튼이 쓴다
  status: "streaming" | "done" | "error";
  answered: boolean | null; // done을 받으면 채워진다
  saved: boolean; // done의 saved. queries에 저장된 답변에만 피드백 버튼을 띄운다
  errorMessage: string | null;
  rating: 1 | -1 | null; // 서버 저장이 성공한 평가
  feedbackError: string | null;
};

type ChatMessageProps = {
  turn: ChatTurn;
  onFeedback: (rating: 1 | -1) => void;
};

export function ChatMessage({ turn, onFeedback }: ChatMessageProps) {
  // 출처는 답변이 다 나온 뒤에, 답을 했을 때만 보여 준다. "매뉴얼에 없음"에 출처를 달면 근거가 있는 것처럼 보인다
  const showSources = turn.status === "done" && turn.answered === true;
  const cited = showSources ? citedSources(turn.answer, turn.sources) : [];
  // 모델이 [n]을 빠뜨리면 출처가 비므로, 검색된 문서를 "참고한 문서"로 대신 보여 준다
  const fallbackDocuments = showSources && cited.length === 0 ? retrievedDocuments(turn.sources) : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="self-end max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
        {turn.question}
      </p>

      <div className="self-start max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
        {turn.answer ? (
          <p className="whitespace-pre-wrap leading-7">{turn.answer}</p>
        ) : turn.status === "streaming" ? (
          <p className="text-zinc-500">매뉴얼을 찾는 중…</p>
        ) : null}

        {turn.status === "error" && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{turn.errorMessage}</p>}

        {cited.length > 0 && (
          <ul className="mt-3 border-t border-zinc-300 pt-2 text-sm text-zinc-600 dark:border-zinc-600 dark:text-zinc-400">
            {cited.map((source) => (
              <li key={source.index}>
                [{source.index}] {source.title}
                {source.heading ? ` > ${source.heading}` : ""}
              </li>
            ))}
          </ul>
        )}

        {fallbackDocuments.length > 0 && (
          <div className="mt-3 border-t border-zinc-300 pt-2 text-sm text-zinc-600 dark:border-zinc-600 dark:text-zinc-400">
            <p>참고한 문서</p>
            <ul>
              {fallbackDocuments.map((document) => (
                <li key={document.slug}>· {document.title}</li>
              ))}
            </ul>
          </div>
        )}

        {/* done을 받고 queries에 저장된 답변에만 보여 준다. 행이 없으면 피드백이 404가 된다 */}
        {turn.status === "done" && turn.saved && turn.queryId && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            {([1, -1] as const).map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => onFeedback(rating)}
                aria-label={rating === 1 ? "도움이 됐어요" : "도움이 안 됐어요"}
                aria-pressed={turn.rating === rating}
                className={`rounded-lg border px-2 py-1 ${
                  turn.rating === rating
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 dark:border-zinc-600"
                }`}
              >
                {rating === 1 ? "👍" : "👎"}
              </button>
            ))}
            {turn.feedbackError && <span className="text-red-600 dark:text-red-400">{turn.feedbackError}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
