import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { adminDb } from "@/lib/server/admin-db";

// The streamer's Kick refresh token, only for chat replies (DESIGN.md § Settings → Chat
// replies). AES-256-GCM with KICK_TOKEN_KEY (32 bytes, base64); Postgres holds iv|tag|ciphertext.
function key(): Buffer {
  const k = Buffer.from(process.env.KICK_TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("KICK_TOKEN_KEY must be 32 bytes, base64");
  return k;
}

function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `\\x${Buffer.concat([iv, c.getAuthTag(), body]).toString("hex")}`;
}

function open(hex: string): string {
  const b = Buffer.from(hex.replace(/^\\x/, ""), "hex");
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

// Called from the sign-in that asked for chat:write: stores the token for the channel this Kick
// user owns and switches replies on. A user without a channel stores nothing.
export async function saveChatToken(kickUserId: number, refreshToken: string, expiresAt: number, scopes: string[]) {
  const db = adminDb();
  const { data: channel } = await db.from("channels").select("id").eq("kick_channel_id", kickUserId).maybeSingle();
  if (!channel) return;
  const { error } = await db.from("kick_tokens").upsert({
    channel_id: channel.id,
    refresh_token_enc: seal(refreshToken),
    expires_at: new Date(expiresAt * 1000).toISOString(),
    scopes,
  });
  if (error) throw new Error(`kick_tokens ${error.message}`);
  await db.from("settings").update({ chat_replies: true }).eq("channel_id", channel.id);
}

// A fresh access token from the stored refresh token. Kick rotates the refresh token, so the new
// one is stored before the access token is used.
// ponytail: refreshes on every call; keep the access token (encrypted, with its expiry) when
// replies are frequent enough for Kick's rate limit to matter.
async function accessToken(channelId: string): Promise<string> {
  const db = adminDb();
  const { data } = await db.from("kick_tokens").select("refresh_token_enc, scopes").eq("channel_id", channelId).maybeSingle();
  if (!data) throw new Error("no kick token");
  const res = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.KICK_CLIENT_ID!,
      client_secret: process.env.KICK_CLIENT_SECRET!,
      refresh_token: open(data.refresh_token_enc as string),
    }),
    cache: "no-store",
  });
  // Kick refused the token (revoked, or expired unused): it goes, replies stay on, and the
  // dashboard asks to reconnect (hasChatToken).
  if (res.status === 400 || res.status === 401) await db.from("kick_tokens").delete().eq("channel_id", channelId);
  if (!res.ok) throw new Error(`kick refresh ${res.status}`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (json.refresh_token) {
    await db
      .from("kick_tokens")
      .update({ refresh_token_enc: seal(json.refresh_token), expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString() })
      .eq("channel_id", channelId);
  }
  return json.access_token;
}

// One message into the channel's own chat as the app's bot (type "bot" posts to the token
// owner's channel; docs.kick.com/apis/chat).
export async function sendChat(channelId: string, content: string): Promise<{ status: number; body: string }> {
  const res = await fetch("https://api.kick.com/public/v1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${await accessToken(channelId)}` },
    body: JSON.stringify({ type: "bot", content }),
    cache: "no-store",
  });
  return { status: res.status, body: (await res.text()).slice(0, 300) };
}

export async function hasChatToken(channelId: string): Promise<boolean> {
  const { count } = await adminDb().from("kick_tokens").select("channel_id", { count: "exact", head: true }).eq("channel_id", channelId);
  return (count ?? 0) > 0;
}

// Replies off, or Delete my data: revoked at Kick (best effort; RFC 7009 takes the token in the
// body) and deleted here either way.
export async function dropChatToken(channelId: string) {
  const db = adminDb();
  const { data } = await db.from("kick_tokens").select("refresh_token_enc").eq("channel_id", channelId).maybeSingle();
  if (!data) return;
  try {
    await fetch("https://id.kick.com/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: open(data.refresh_token_enc as string), token_hint_type: "refresh_token" }),
      cache: "no-store",
    });
  } catch (e) {
    console.error(JSON.stringify({ route: "kick/revoke", error: String(e).slice(0, 120) }));
  }
  await db.from("kick_tokens").delete().eq("channel_id", channelId);
}
