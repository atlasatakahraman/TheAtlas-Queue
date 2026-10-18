// Runs one SQL check against the local Supabase stack only (`bun run supabase:start` first),
// inside begin … rollback, so nothing stays. Production is shared and live (ADR 0085): its
// checks are read-only, and every rolled-back assert runs here instead.
const file = Bun.argv[2];
if (!file) {
  console.error("usage: bun run supabase:check <file.sql>");
  process.exit(2);
}
const sql = `begin;\n${await Bun.file(file).text()}\nrollback;\n`;

const psql = Bun.spawn(
  ["docker", "exec", "-i", "supabase_db_theatlas-queue", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
  { stdin: new Blob([sql]), stdout: "pipe", stderr: "inherit" },
);
const out = (await new Response(psql.stdout).text()).trim().split("\n");
const code = await psql.exited;
console.log(out.at(-1) ?? "");
process.exit(code);
