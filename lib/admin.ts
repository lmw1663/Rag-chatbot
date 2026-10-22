// 관리자 페이지 데이터 접근 계층. 데이터를 읽기 직전에 인증을 다시 확인한다(proxy.ts는 사전 확인일 뿐이다).
// 집계는 DB의 SQL 함수(20261022035820_admin_dashboard_functions.sql)가 한다.
// 서버 전용: secret 키를 쓰는 Supabase 클라이언트를 쓴다.
import { headers } from "next/headers";
import { isAuthorizedAdmin } from "./admin-auth";
import { getSupabaseServer } from "./supabase-server";

export const ADMIN_DAYS = 30; // 최근 며칠을 집계할지
export const ADMIN_TOP_N = 10;

export type AdminSummary = {
  total: number;
  answered: number;
  unanswered: number;
  failed: number;
  upvotes: number;
  downvotes: number;
  median_latency_ms: number | null;
};
export type UnansweredRow = { question: string; times: number; last_asked_at: string };
export type DownvotedRow = {
  question: string;
  downvotes: number;
  upvotes: number;
  latest_downvoted_answer: string | null;
  last_asked_at: string;
};

export type AdminDashboard = {
  summary: AdminSummary;
  unanswered: UnansweredRow[];
  downvoted: DownvotedRow[];
};

export class AdminUnauthorizedError extends Error {}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const requestHeaders = await headers();
  if (!isAuthorizedAdmin(requestHeaders.get("authorization"))) throw new AdminUnauthorizedError("관리자 인증이 필요합니다");

  const supabase = getSupabaseServer();
  const [summary, unanswered, downvoted] = await Promise.all([
    supabase.rpc("admin_summary", { p_days: ADMIN_DAYS }).single<AdminSummary>(),
    supabase.rpc("admin_top_unanswered", { p_limit: ADMIN_TOP_N, p_days: ADMIN_DAYS }),
    supabase.rpc("admin_top_downvoted", { p_limit: ADMIN_TOP_N, p_days: ADMIN_DAYS }),
  ]);
  for (const result of [summary, unanswered, downvoted]) {
    if (result.error) throw new Error(`관리자 집계 조회 실패: ${result.error.message}`);
  }

  return {
    summary: summary.data as AdminSummary,
    unanswered: (unanswered.data ?? []) as UnansweredRow[],
    downvoted: (downvoted.data ?? []) as DownvotedRow[],
  };
}
