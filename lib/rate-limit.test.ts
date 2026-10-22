import { describe, expect, it } from "vitest";
import { checkIpRateLimit, clientIp, type IpStore } from "./rate-limit";

const window = { limit: 3, windowMs: 60_000 };

describe("checkIpRateLimit", () => {
  it("윈도 안에서 limit번까지 통과하고 그다음은 막는다", () => {
    const store: IpStore = new Map();
    const results = [0, 1000, 2000, 3000].map((t) => checkIpRateLimit("1.1.1.1", window, t, store).ok);
    expect(results).toEqual([true, true, true, false]);
  });

  it("막을 때 가장 오래된 요청이 윈도를 벗어날 때까지의 초를 알려준다", () => {
    const store: IpStore = new Map();
    for (const t of [0, 1000, 2000]) checkIpRateLimit("1.1.1.1", window, t, store);
    expect(checkIpRateLimit("1.1.1.1", window, 30_000, store)).toEqual({ ok: false, retryAfterSec: 30 });
  });

  it("막힌 요청은 세지 않아서, 오래된 요청이 빠지면 다시 통과한다", () => {
    const store: IpStore = new Map();
    for (const t of [0, 1000, 2000]) checkIpRateLimit("1.1.1.1", window, t, store);
    for (let t = 3000; t < 60_000; t += 5000) checkIpRateLimit("1.1.1.1", window, t, store); // 막히는 동안 계속 시도
    expect(checkIpRateLimit("1.1.1.1", window, 60_001, store).ok).toBe(true); // 0초 요청이 빠짐
  });

  it("IP마다 따로 센다", () => {
    const store: IpStore = new Map();
    for (const t of [0, 1, 2]) checkIpRateLimit("1.1.1.1", window, t, store);
    expect(checkIpRateLimit("1.1.1.1", window, 3, store).ok).toBe(false);
    expect(checkIpRateLimit("2.2.2.2", window, 3, store).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("x-real-ip를 먼저 쓰고, 없으면 x-forwarded-for의 첫 값을 쓴다", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "3.3.3.3", "x-forwarded-for": "4.4.4.4" } }))).toBe("3.3.3.3");
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "4.4.4.4, 10.0.0.1" } }))).toBe("4.4.4.4");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
