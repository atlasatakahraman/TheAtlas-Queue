// Deploys a Vercel **preview** (never production) and points the stable alias at it, so Kick
// has one public URL for webhooks and sign-in. The env rides on this deployment only (-e/-b), not
// the project's settings; Bun loads the values from .env.local, and nothing is printed.
// Run: bun --bun scripts/preview.ts   (after `bunx --bun vercel login` and `vercel link`)
import { $ } from "bun";

const ALIAS = "theatlas-queue-preview.vercel.app";
const BUILD = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const RUNTIME = ["AUTH_SECRET", "KICK_CLIENT_ID", "KICK_CLIENT_SECRET", "RIOT_API_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_JWT_PRIVATE_JWK", "KICK_TOKEN_KEY"];

const missing = [...BUILD, ...RUNTIME].filter((k) => !process.env[k]);
if (missing.length) throw new Error(`.env.local lacks ${missing.join(", ")}`);

const pair = (k: string) => `${k}=${process.env[k]}`;
const args = [
  ...BUILD.flatMap((k) => ["-b", pair(k), "-e", pair(k)]),
  ...RUNTIME.flatMap((k) => ["-e", pair(k)]),
  "-e", `AUTH_URL=https://${ALIAS}`,
];

// vercel 60 prints JSON on a non-TTY stdout (a bare URL before); take the first deployment URL.
const out = await $`bunx --bun vercel deploy --yes ${args}`.quiet().text();
const url = out.match(/https:\/\/[\w.-]+\.vercel\.app/)?.[0];
if (!url) throw new Error("no deployment URL in vercel's output");
await $`bunx --bun vercel alias set ${url} ${ALIAS}`.quiet();
console.log(`${url} -> https://${ALIAS}`);
