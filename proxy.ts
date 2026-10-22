// /admin 사전 확인: Basic 인증이 없거나 틀리면 401과 함께 브라우저 로그인 창을 띄운다.
// 응답 헤더(WWW-Authenticate)를 직접 만들 수 있는 곳이 proxy라서 여기서 막는다.
// 데이터를 읽는 lib/admin.ts에서도 같은 검사를 다시 한다. matcher를 실수로 바꿔도 데이터가 새지 않게 하기 위해서다.
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_REALM, isAuthorizedAdmin } from "@/lib/admin-auth";

export function proxy(request: NextRequest) {
  if (isAuthorizedAdmin(request.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("관리자 인증이 필요합니다", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${ADMIN_REALM}", charset="UTF-8"` },
  });
}

export const config = {
  matcher: ["/admin/:path*"],
};
