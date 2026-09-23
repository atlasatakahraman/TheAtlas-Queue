import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The webhook proves itself with Kick's signature, the health route with its bearer.
const PUBLIC_PREFIXES = ["/api/auth", "/_next", "/favicon", "/TheAtlas", "/api/kick/webhook", "/api/cron/"];
// `/` is the home page and the sign-in page.
const PUBLIC_EXACT = new Set(["/"]);

function csp(nonce: string) {
  const dev = process.env.NODE_ENV !== "production";
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Kick avatars; Riot profile icons from Data Dragon (the queue table's avatars).
    "img-src 'self' data: blob: https://*.kick.com https://ddragon.leagueoflegends.com",
    "font-src 'self'",
    `connect-src 'self'${supabase ? ` ${supabase} ${supabase.replace("https://", "wss://")}` : ""}`,
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
      const home = new URL("/", request.url);
      home.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
      return NextResponse.redirect(home);
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
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
