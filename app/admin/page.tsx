import type { Metadata } from "next";
import { Suspense } from "react";
import { ADMIN_DAYS, ADMIN_TOP_N, AdminUnauthorizedError, getAdminDashboard } from "@/lib/admin";

export const metadata: Metadata = {
  title: "관리자 | 매장 업무 매뉴얼 챗봇",
  robots: { index: false, follow: false }, // 검색 엔진에 노출하지 않는다
};

// 요청 헤더(인증)와 DB를 읽으므로 요청 시점에 그린다. Cache Components에서는 <Suspense> 안에서 읽어야 한다
export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-xl font-semibold">관리자</h1>
      <p className="mt-1 text-sm text-zinc-500">최근 {ADMIN_DAYS}일 기준</p>
      <Suspense fallback={<p className="mt-6 text-zinc-500">불러오는 중…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  let data;
  try {
    data = await getAdminDashboard();
  } catch (error) {
    if (error instanceof AdminUnauthorizedError) return <p className="mt-6 text-red-600">관리자 인증이 필요합니다.</p>;
    throw error;
  }
  const { summary, unanswered, downvoted } = data;

  const stats = [
    ["전체 질문", summary.total],
    ["답변", summary.answered],
    ["답 못 함", summary.unanswered],
    ["오류·중단", summary.failed],
    ["👍 / 👎", `${summary.upvotes} / ${summary.downvotes}`],
    ["응답 시간 중앙값", summary.median_latency_ms === null ? "-" : `${(summary.median_latency_ms / 1000).toFixed(1)}초`],
  ] as const;

  return (
    <>
      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="text-sm text-zinc-500">{label}</dt>
            <dd className="mt-1 text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <Section title={`👎 많은 질문 TOP ${ADMIN_TOP_N}`} empty={downvoted.length === 0}>
        {downvoted.map((row) => (
          <tr key={row.question} className="border-t border-zinc-200 align-top dark:border-zinc-800">
            <td className="py-2 pr-3">
              <p>{row.question}</p>
              {row.latest_downvoted_answer && (
                <p className="mt-1 line-clamp-2 text-sm text-zinc-500">답변: {row.latest_downvoted_answer}</p>
              )}
            </td>
            <td className="whitespace-nowrap py-2 pr-3 text-right">
              👎 {row.downvotes} · 👍 {row.upvotes}
            </td>
            <td className="whitespace-nowrap py-2 text-right text-sm text-zinc-500">{formatDate(row.last_asked_at)}</td>
          </tr>
        ))}
      </Section>

      <Section title={`답 못 한 질문 TOP ${ADMIN_TOP_N}`} empty={unanswered.length === 0}>
        {unanswered.map((row) => (
          <tr key={row.question} className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="py-2 pr-3">{row.question}</td>
            <td className="whitespace-nowrap py-2 pr-3 text-right">{row.times}회</td>
            <td className="whitespace-nowrap py-2 text-right text-sm text-zinc-500">{formatDate(row.last_asked_at)}</td>
          </tr>
        ))}
      </Section>
      <p className="mt-2 text-sm text-zinc-500">
        답 못 한 질문은 매뉴얼에 없거나 답을 거절한 질문입니다. 자주 나오는 질문은 매뉴얼에 추가할 후보입니다. 오류·중단은 포함하지 않습니다.
      </p>
    </>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-semibold">{title}</h2>
      {empty ? (
        <p className="mt-2 text-zinc-500">아직 없습니다.</p>
      ) : (
        <table className="mt-2 w-full text-left">
          <tbody>{children}</tbody>
        </table>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
