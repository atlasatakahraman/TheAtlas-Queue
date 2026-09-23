import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mintSupabaseJwt } from "@/lib/server/mint";

// A server-side client acting as the signed-in user: RLS and the member RPCs apply exactly as
// in the browser. Used for the dashboard's first, server-rendered paint.
export function userDb(profileId: string): SupabaseClient {
  const { token } = mintSupabaseJwt(profileId, 60);
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    accessToken: async () => token,
  });
}
