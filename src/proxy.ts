import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/backend/session";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublicRoute = pathname === "/" || pathname.startsWith("/login");
  const isApiRoute = pathname.startsWith("/api");
  if (isPublicRoute || isApiRoute || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("reason", "sign-in-required");
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
