import "server-only";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";

let key: KeyObject | undefined;
let kid = "";

function signingKey(): KeyObject {
  if (key) return key;
  const { kid: id, alg: _alg, use: _use, ...jwk } = JSON.parse(process.env.SUPABASE_JWT_PRIVATE_JWK!);
  kid = id;
  return (key = createPrivateKey({ key: jwk, format: "jwk" }));
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

// A Supabase user token for `sub` (profiles.id); RLS reads it through auth.uid().
// ponytail: 10-minute TTL bounds how long a removed mod's open realtime subscription lives;
// shorten it if that ever matters (spec § Realtime, known limit).
export function mintSupabaseJwt(sub: string, ttlSeconds = 600): { token: string; exp: number } {
  const k = signingKey();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const header = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`,
      sub,
      aud: "authenticated",
      role: "authenticated",
      aal: "aal1",
      iat,
      exp,
    }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key: k, dsaEncoding: "ieee-p1363" });
  return { token: `${header}.${payload}.${b64url(signature)}`, exp };
}
