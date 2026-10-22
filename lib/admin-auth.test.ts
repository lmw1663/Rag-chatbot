import { describe, expect, it } from "vitest";
import { isAuthorizedAdmin } from "./admin-auth";

const env = { ADMIN_USERNAME: "manager", ADMIN_PASSWORD: "p:ss word" };
const basic = (user: string, password: string) => "Basic " + Buffer.from(`${user}:${password}`).toString("base64");

describe("isAuthorizedAdmin", () => {
  it("아이디와 비밀번호가 모두 맞으면 통과한다 (비밀번호 안의 ':'와 공백 포함)", () => {
    expect(isAuthorizedAdmin(basic("manager", "p:ss word"), env)).toBe(true);
  });

  it("아이디나 비밀번호가 틀리면 막는다", () => {
    expect(isAuthorizedAdmin(basic("manager", "wrong"), env)).toBe(false);
    expect(isAuthorizedAdmin(basic("crew", "p:ss word"), env)).toBe(false);
    expect(isAuthorizedAdmin(basic("manager", "p:ss word "), env)).toBe(false);
  });

  it("헤더가 없거나 Basic 형식이 아니면 막는다", () => {
    expect(isAuthorizedAdmin(null, env)).toBe(false);
    expect(isAuthorizedAdmin("Bearer abc", env)).toBe(false);
    expect(isAuthorizedAdmin("Basic " + Buffer.from("no-colon").toString("base64"), env)).toBe(false);
  });

  it("환경 변수가 없으면 무엇을 보내도 막는다 (fail-closed)", () => {
    expect(isAuthorizedAdmin(basic("", ""), {})).toBe(false);
    expect(isAuthorizedAdmin(basic("manager", ""), { ADMIN_USERNAME: "manager" })).toBe(false);
  });
});
