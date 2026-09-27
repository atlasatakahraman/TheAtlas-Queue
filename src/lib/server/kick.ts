import "server-only";
import { createPublicKey, verify, type KeyObject } from "node:crypto";

const API = "https://api.kick.com/public/v1";
export const EVENTS = ["chat.message.sent", "livestream.status.updated"] as const;

// Kick's webhook signing key as published at docs.kick.com/events/webhook-security. After a
// failed verify it is refetched from /public-key, at most every 10 minutes, in case Kick rotates.
const DOCUMENTED_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

// `next dev` only: a local PEM so the route can be driven with self-signed requests.
const TEST_KEY = process.env.NODE_ENV === "development" ? process.env.KICK_WEBHOOK_TEST_KEY : undefined;

let publicKey: KeyObject = createPublicKey(TEST_KEY?.replaceAll("\\n", "\n") ?? DOCUMENTED_KEY);
let keyFetchedAt = 0;

function verifyWith(key: KeyObject, id: string, timestamp: string, body: Buffer, signature: string): boolean {
  try {
    return verify("sha256", Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body]), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// RSA PKCS#1 v1.5 SHA-256 over `id.timestamp.rawBody`.
export async function verifyWebhook(id: string, timestamp: string, body: Buffer, signature: string): Promise<boolean> {
  if (verifyWith(publicKey, id, timestamp, body, signature)) return true;
  if (TEST_KEY || Date.now() - keyFetchedAt < 10 * 60_000) return false;
  keyFetchedAt = Date.now();
  try {
    const res = await kick(`${API}/public-key`);
    const pem = ((await res.json()) as { data?: { public_key?: string } }).data?.public_key;
    if (!pem) return false;
    publicKey = createPublicKey(pem);
  } catch (e) {
    console.error(JSON.stringify({ route: "kick/public-key", error: String(e).slice(0, 120) }));
    return false;
  }
  return verifyWith(publicKey, id, timestamp, body, signature);
}

let app: { token: string; until: number } | undefined;

// App access token (client credentials): intake needs no streamer token (spec § Architecture).
async function appToken(): Promise<string> {
  if (app && app.until > Date.now()) return app.token;
  const res = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.KICK_CLIENT_ID!,
      client_secret: process.env.KICK_CLIENT_SECRET!,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kick token ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number | string };
  app = { token: json.access_token, until: Date.now() + (Number(json.expires_in) - 60) * 1000 };
  return app.token;
}

async function kick(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${await appToken()}` },
    cache: "no-store",
  });
  if (res.status === 401) app = undefined;
  // Kick's body says why (a 400 on subscribe only made sense with it); ensureSubscriptions caps it.
  if (!res.ok) throw new Error(`kick ${new URL(url).pathname} ${res.status} ${(await res.text()).trim()}`.trim());
  return res;
}

export async function kickChannel(broadcasterId: number): Promise<{ slug: string } | null> {
  const res = await kick(`${API}/channels?broadcaster_user_id=${broadcasterId}`);
  const json = (await res.json()) as { data?: { slug?: string }[] };
  const slug = json.data?.[0]?.slug;
  return slug ? { slug } : null;
}

// Creates whichever of the two event subscriptions the channel lacks. Returns null when both
// exist, else a short error for channels.subscription_error.
// ponytail: one filtered list call per channel; one unfiltered call if channel counts grow.
export async function ensureSubscriptions(broadcasterId: number): Promise<string | null> {
  try {
    const res = await kick(`${API}/events/subscriptions?broadcaster_user_id=${broadcasterId}`);
    const have = new Set(
      ((await res.json()) as { data?: { event: string; broadcaster_user_id: number }[] }).data
        ?.filter((s) => s.broadcaster_user_id === broadcasterId)
        .map((s) => s.event),
    );
    const missing = EVENTS.filter((e) => !have.has(e));
    if (missing.length === 0) return null;
    await kick(`${API}/events/subscriptions`, {
      method: "POST",
      body: JSON.stringify({
        broadcaster_user_id: broadcasterId,
        events: missing.map((name) => ({ name, version: 1 })),
        method: "webhook",
      }),
    });
    return null;
  } catch (e) {
    return String(e instanceof Error ? e.message : e).slice(0, 200);
  }
}

// A Kick user by their channel slug (their username, lower-cased): the owner pre-adding a
// moderator types a name, and channel_members is keyed by the Kick user id.
export async function kickUserBySlug(slug: string): Promise<{ id: number; slug: string } | null> {
  const res = await kick(`${API}/channels?slug=${encodeURIComponent(slug)}`);
  const c = ((await res.json()) as { data?: { broadcaster_user_id?: number; slug?: string }[] }).data?.[0];
  return c?.broadcaster_user_id && c.slug ? { id: c.broadcaster_user_id, slug: c.slug } : null;
}
