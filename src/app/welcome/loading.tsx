import { cookies } from "next/headers";
import { STEP, STEP_HEAD, WELCOME } from "@/components/queue/geometry";
import { Shade } from "@/components/queue/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { LANG_COOKIE, parseLang, translate } from "@/lib/i18n";

// While /welcome checks the session (DESIGN.md § Designed ahead → skeletons): the page as it first
// shows (the channel being set up, the later steps waiting for it), from its own classes
// (geometry.ts) and words drawn transparent (owner, 2026-09-28, 10.10).
export default async function WelcomeLoading() {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, undefined, vars);
  const step = (n: number, title: string, lines: string[]) => (
    <section className={STEP}>
      <div className={STEP_HEAD}>
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <Shade>{title}</Shade>
      </div>
      {lines.map((l) => (
        <Shade key={l} wrap>
          {l}
        </Shade>
      ))}
    </section>
  );
  return (
    <div aria-busy className={WELCOME}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Shade className="font-serif text-display max-md:text-title">{t("welcome.title")}</Shade>
          <Shade wrap>{t("welcome.hint")}</Shade>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <Skeleton className="h-9 w-16" />
          <Skeleton className="size-9" />
        </span>
      </div>
      {step(1, t("welcome.step.channel"), [t("welcome.signed_in", { name: "atlasatakahraman" }), t("welcome.setting_up")])}
      {step(2, t("welcome.step.join"), [t("welcome.after_channel")])}
      {step(3, t("welcome.step.try"), [t("welcome.after_channel")])}
    </div>
  );
}
