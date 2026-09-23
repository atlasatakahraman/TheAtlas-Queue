import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/server/admin-db";
import { ensureSubscriptions } from "@/lib/server/kick";

// Called every 10 minutes by pg_cron through pg_net (migration 0013). Re-creates any Kick event
// subscription a channel lost (Kick drops them after a day of failed deliveries) and records the
// outcome for the connection pill. The bearer lives only in Supabase Vault; cron_secret_ok
// compares it there.
export async function POST(request: NextRequest) {
  const started = Date.now();
  const secret = request.headers.get("authorization")?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if (!secret) return new NextResponse(null, { status: 401 });
  const db = adminDb();
  const { data: ok } = await db.rpc("cron_secret_ok", { p_secret: secret });
  if (ok !== true) return new NextResponse(null, { status: 401 });

  const { data: channels, error } = await db.from("channels").select("id, kick_channel_id");
  if (error) return new NextResponse(null, { status: 500 });
  let failed = 0;
  for (const c of channels) {
    const problem = await ensureSubscriptions(c.kick_channel_id);
    if (problem) failed++;
    await db.rpc("set_subscription_state", { p_channel: c.id, p_error: problem });
  }
  console.log(JSON.stringify({ route: "cron/health", channels: channels.length, failed, ms: Date.now() - started }));
  return NextResponse.json({ channels: channels.length, failed }, { headers: { "Cache-Control": "no-store" } });
}
