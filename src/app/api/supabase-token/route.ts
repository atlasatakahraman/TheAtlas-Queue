import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { mintSupabaseJwt } from "@/lib/server/mint";
import { ensureProfile } from "@/lib/server/profile";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST() {
  let profileId: string | null;
  try {
    profileId = await ensureProfile(await auth());
  } catch (e) {
    console.error(JSON.stringify({ route: "supabase-token", error: String(e).slice(0, 120) }));
    return NextResponse.json({ error: "profile" }, { status: 500, headers: NO_STORE });
  }
  if (!profileId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  return NextResponse.json(mintSupabaseJwt(profileId), { headers: NO_STORE });
}
