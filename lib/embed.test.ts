import { describe, expect, it } from "vitest";
import { INTERACTIVE_RETRY, retryDelayMs } from "./embed";

describe("retryDelayMs", () => {
  it("Retry-After가 초로 오면 그대로 따른다", () => {
    expect(retryDelayMs(429, "7", 1)).toBe(7000);
  });

  it("Retry-After가 HTTP 날짜로 오면 남은 시간만큼 기다린다", () => {
    const now = Date.parse("2026-10-22T05:00:00Z");
    expect(retryDelayMs(429, "Thu, 22 Oct 2026 05:00:30 GMT", 1, undefined, now)).toBe(30_000);
  });

  it("헤더가 없으면 429는 분 단위 한도에 맞춰 20초씩 늘린다", () => {
    expect([1, 2, 3].map((attempt) => retryDelayMs(429, null, attempt))).toEqual([20_000, 40_000, 60_000]);
  });

  it("헤더가 없으면 5xx는 1초, 2초, 4초로 짧게 기다린다", () => {
    expect([1, 2, 3].map((attempt) => retryDelayMs(503, null, attempt))).toEqual([1000, 2000, 4000]);
  });

  it("대기 시간은 1초~60초로 자르고, 이상한 헤더는 무시한다", () => {
    expect(retryDelayMs(429, "3600", 1)).toBe(60_000);
    expect(retryDelayMs(429, "0", 1)).toBe(1000);
    expect(retryDelayMs(429, "곧", 1)).toBe(20_000);
    expect(retryDelayMs(429, null, 4)).toBe(60_000);
  });

  it("사용자가 기다리는 요청은 Retry-After가 길어도 최대 2초만 기다린다", () => {
    expect(retryDelayMs(429, "30", 1, INTERACTIVE_RETRY.maxDelayMs)).toBe(2000);
    expect(retryDelayMs(429, null, 1, INTERACTIVE_RETRY.maxDelayMs)).toBe(2000);
  });
});
