// 조립된 프롬프트로 Claude 답변을 만든다. /api/chat과 평가 스크립트(scripts/eval)가 같은 함수를 쓴다.
// 평가가 앱과 다른 코드를 돌리면 점수가 앱의 실제 품질을 말해 주지 못하므로, 답변 생성은 여기 한 곳에만 둔다.
// 서버 전용: ANTHROPIC_API_KEY를 쓴다.
import Anthropic from "@anthropic-ai/sdk";
import { NO_ANSWER_MESSAGE, type BuiltPrompt } from "./build-prompt";

export const DEFAULT_CHAT_MODEL: Anthropic.Model = "claude-haiku-5-5";
export const REFUSAL_MESSAGE = "이 질문에는 답할 수 없습니다.";

export type GenerateAnswerOptions = {
  model?: Anthropic.Model; // 3일차 Haiku/Sonnet 비교용
  signal?: AbortSignal; // 사용자가 연결을 끊으면 Claude 요청도 끊는다
  onText?: (text: string) => void; // 답변 조각이 나올 때마다 호출된다(스트리밍 전송용)
};

export type GeneratedAnswer = {
  answer: string; // onText로 내보낸 조각을 모두 이은 것과 같다
  answered: boolean; // false: 매뉴얼에 없음 또는 거절
  refused: boolean;
  model: Anthropic.Model | null; // LLM을 부르지 않았으면 null
  usage: Anthropic.Usage | null; // 평가 스크립트의 비용 계산용
};

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  anthropic ??= new Anthropic(); // 키를 모듈 로드 시점이 아니라 첫 호출 때 읽는다
  return anthropic;
}

// 실패(API 오류, 중단)하면 에러를 던진다. 실패를 어떻게 알리고 기록할지는 호출하는 쪽이 정한다.
export async function generateAnswer(
  prompt: BuiltPrompt,
  { model = DEFAULT_CHAT_MODEL, signal, onText }: GenerateAnswerOptions = {},
): Promise<GeneratedAnswer> {
  // 검색된 청크가 하나도 없으면 LLM을 부르지 않는다
  if (prompt.sources.length === 0) {
    onText?.(NO_ANSWER_MESSAGE);
    return { answer: NO_ANSWER_MESSAGE, answered: false, refused: false, model: null, usage: null };
  }

  const stream = getAnthropic().messages.stream(
    {
      model,
      max_tokens: 4096,
      output_config: { effort: "low" }, // 짧은 Q&A라 응답 속도를 우선한다
      system: prompt.system,
      messages: [{ role: "user", content: prompt.userMessage }],
    },
    { signal },
  );

  let answer = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      answer += event.delta.text;
      onText?.(event.delta.text);
    }
  }
  const final = await stream.finalMessage();

  const refused = final.stop_reason === "refusal";
  if (refused) {
    // 이미 내보낸 앞부분 뒤에 안내를 덧붙인다. 덮어쓰면 화면과 로그의 답변이 달라진다
    const notice = (answer ? "\n\n" : "") + REFUSAL_MESSAGE;
    answer += notice;
    onText?.(notice);
  }

  return { answer, answered: isAnswered(answer, refused), refused, model, usage: final.usage };
}

// 답을 했는지 판단한다. 매뉴얼 근거로 답했다면 발췌 번호 [n]이 붙어 있어야 한다(프롬프트 규칙).
// 3일차 평가에서 "매뉴얼 발췌에 ~ 내용은 없습니다"처럼 고정 문장으로 시작하지 않는 거절이 "답함"으로 잘못 기록됐다.
// 그래서 고정 문장 검사에 더해, 인용이 하나도 없으면 답하지 않은 것으로 본다.
// 반대 위험: 진짜 답에서 [n]을 빠뜨리면 "답 못 함"으로 기록된다. 평가의 답변 여부 정확도로 확인한다.
export function isAnswered(answer: string, refused: boolean): boolean {
  if (refused) return false;
  if (answer.trim().startsWith(NO_ANSWER_MESSAGE)) return false;
  return /\[\d+\]/.test(answer);
}
