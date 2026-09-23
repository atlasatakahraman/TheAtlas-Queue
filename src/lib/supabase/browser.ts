"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
let cached: { token: string; exp: number } | undefined;
let inflight: Promise<string | null> | undefined;

// Refreshes a minute before expiry; one request at a time however many callers ask.
async function accessToken(): Promise<string | null> {
  if (cached && cached.exp - 60 > Date.now() / 1000) return cached.token;
  inflight ??= fetch("/api/supabase-token", { method: "POST" })
    .then(async (r) => {
      // Signed out (spec § Error handling → Token 401): back to sign-in, returning here after.
      if (r.status === 401) {
        // A full load on purpose: this runs outside React, and sign-in starts over on the server.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return null;
      }
      return r.ok ? (cached = (await r.json()) as { token: string; exp: number }).token : null;
    })
    .catch(() => null)
    .finally(() => (inflight = undefined));
  return inflight;
}

// One client per tab. Never put it in a dependency array.
export function db(): SupabaseClient {
  return (client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { accessToken },
  ));
}
