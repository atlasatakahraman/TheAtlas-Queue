// Runs after `next build`. Fails when a secret can reach the browser.
import { Glob } from "bun";

const failures: string[] = [];

// 1. Source: the admin client and the minting key live only on the server side. A file that
// opens with `import "server-only"` also counts: Next fails the build if a client imports it.
const SERVER_ONLY = /^src\/(app\/api\/|lib\/server\/)/;
for await (const file of new Glob("src/**/*.{ts,tsx}").scan(".")) {
  const path = file.replaceAll("\\", "/");
  const text = await Bun.file(file).text();
  for (const needle of ["@/lib/server/", "SUPABASE_SECRET_KEY", "SUPABASE_JWT_PRIVATE_JWK", "RIOT_API_KEY", "KICK_TOKEN_KEY"]) {
    if (text.includes(needle) && !SERVER_ONLY.test(path) && !text.startsWith('import "server-only";')) failures.push(`${path} references ${needle}`);
  }
}

// 2. Bundle: no secret value, and no secret-shaped string, in anything shipped to browsers.
const values = ["SUPABASE_SECRET_KEY", "RIOT_API_KEY", "KICK_CLIENT_SECRET", "AUTH_SECRET", "KICK_TOKEN_KEY", "CRON_SECRET"]
  .map((k) => process.env[k])
  .filter((v): v is string => !!v && v.length >= 16);
const jwk = process.env.SUPABASE_JWT_PRIVATE_JWK;
if (jwk) values.push(JSON.parse(jwk).d as string);
const shapes = [/sb_secret_[A-Za-z0-9_-]{10,}/, /RGAPI-[0-9a-f-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

for await (const file of new Glob(".next/static/**/*.{js,css,html,json}").scan(".")) {
  const text = await Bun.file(file).text();
  for (const v of values) if (text.includes(v)) failures.push(`${file} contains a secret value`);
  for (const s of shapes) if (s.test(text)) failures.push(`${file} matches ${s}`);
}

if (failures.length) {
  console.error("check:secrets failed:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("check:secrets ok");
