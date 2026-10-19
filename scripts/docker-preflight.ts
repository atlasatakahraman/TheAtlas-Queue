// Fails fast when Docker Desktop is wedged, before supabase start / db reset hang on it. On
// 2026-10-19 the Windows VM stopped starting containers: the db container stayed "Created", the CLI
// waited forever at "Starting database..." (15+ min, no error), and realtime crash-looped on
// "DB_HOST: nxdomain". A bare run answers in ~2 s when Docker is healthy.
const run = Bun.spawn(["docker", "run", "--rm", "alpine:3", "true"], { stdout: "ignore", stderr: "inherit" });
const timer = setTimeout(() => run.kill(), 60_000);  // the first run also pulls alpine (~3 MB)
const code = await run.exited;
clearTimeout(timer);
if (code !== 0) {
  console.error("Docker did not start a container within 60 s. Run `docker desktop restart`, then retry.");
  console.error("See docs/DEVELOPMENT.md § Local database checks → When the stack hangs.");
  process.exit(1);
}
