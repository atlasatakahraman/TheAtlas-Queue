import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/api/auth", "/_next", "/favicon", "/ranks", "/TheAtlas"];
const PUBLIC_EXACT = new Set(["/login"]);

function csp(nonce: string) {
  const dev = process.env.NODE_ENV !== "production";
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://ddragon.leagueoflegends.com https://*.kick.com",
    "font-src 'self'",
    // Pusher + kick.com serve the August chat listener; they leave in Stage 4.
    `connect-src 'self' wss://ws-us2.pusher.com https://kick.com${supabase ? ` ${supabase} ${supabase.replace("https://", "wss://")}` : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://id.kick.com",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce);

  const isPublic = PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic) {
    const session =
      request.cookies.get("authjs.session-token") ?? request.cookies.get("__Secure-authjs.session-token");
    if (!session) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|ranks/).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
