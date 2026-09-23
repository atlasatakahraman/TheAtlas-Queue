import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { adminDb } from "@/lib/server/admin-db";
import { mintSupabaseJwt } from "@/lib/server/mint";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST() {
  const session = await auth();
  const kickUserId = Number((session as { kickUserId?: string } | null)?.kickUserId ?? session?.user?.id);
  const username = session?.user?.name;
  if (!Number.isSafeInteger(kickUserId) || kickUserId <= 0 || !username) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const { data, error } = await adminDb()
    .from("profiles")
    .upsert(
      {
        kick_user_id: kickUserId,
        username: username.slice(0, 64),
        avatar_url: session.user?.image?.startsWith("https://") ? session.user.image : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "kick_user_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    console.error(JSON.stringify({ route: "supabase-token", error: error?.code ?? "no-row" }));
    return NextResponse.json({ error: "profile" }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(mintSupabaseJwt(data.id), { headers: NO_STORE });
}
