import { describe, expect, it } from "vitest";
import { isAnswered } from "./generate-answer";

describe("isAnswered", () => {
  it("발췌 번호를 인용한 답변은 답한 것으로 본다", () => {
    expect(isAnswered("근무 시작 30분 전에 매니저에게 전화합니다. [1]", false)).toBe(true);
  });

  it("'매뉴얼에 없음'으로 시작하면 인용이 있어도 답하지 않은 것으로 본다", () => {
    expect(isAnswered("매뉴얼에 없음", false)).toBe(false);
    expect(isAnswered("매뉴얼에 없음 [1]", false)).toBe(false);
  });

  it("고정 문장 없이 거절해도 인용이 없으면 답하지 않은 것으로 본다 (3일차 평가 u02, h18)", () => {
    expect(isAnswered("매뉴얼 발췌에 알레르기 정보표를 교체하는 주기에 대한 내용은 없습니다.", false)).toBe(false);
    expect(isAnswered("매뉴얼 발췌에 재고 실사 주기에 대한 내용이 없어 답할 수 없습니다.\n\n매뉴얼에 없음", false)).toBe(false);
  });

  it("일부만 답하고 나머지는 없다고 밝힌 답변은 답한 것으로 본다", () => {
    expect(isAnswered("늦어도 3시간 전까지 전화합니다. [1]\n주휴수당은 매뉴얼에 없습니다.", false)).toBe(true);
  });

  it("거절(refusal)이면 인용이 있어도 답하지 않은 것으로 본다", () => {
    expect(isAnswered("앞부분 [1]\n\n이 질문에는 답할 수 없습니다.", true)).toBe(false);
  });
});
