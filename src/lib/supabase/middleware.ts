import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "./env";

function authUnavailableResponse(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublicRoute = pathname === "/" || pathname.startsWith("/login");
  const isApiRoute = pathname.startsWith("/api");

  // Public pages have a useful guest experience, and API handlers perform
  // their own authorization. Protected pages still fail closed.
  if (isPublicRoute || isApiRoute) {
    return NextResponse.next({ request });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("reason", "auth-unavailable");
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    console.error("[proxy] Supabase auth is not configured", {
      pathname: request.nextUrl.pathname,
      missingUrl: !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
      missingAnonKey: !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
    });
    return authUnavailableResponse(request);
  }

  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isAuthRoute = request.nextUrl.pathname.startsWith("/login");
    const isApiRoute = request.nextUrl.pathname.startsWith("/api");

    if (!user && !isAuthRoute && !isApiRoute && request.nextUrl.pathname !== "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (user && isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch (error) {
    console.error("[proxy] Supabase session refresh failed", {
      pathname: request.nextUrl.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    return authUnavailableResponse(request);
  }
}
