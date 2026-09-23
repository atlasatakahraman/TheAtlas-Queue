import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LANG_COOKIE, parseLang, translate } from "@/lib/i18n";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NotFound() {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-16">
      <p className="font-serif text-numeral text-muted-foreground tabular-nums">404</p>
      <h1 className="font-serif text-title">{t("notfound.title")}</h1>
      <p className="text-muted-foreground">{t("notfound.hint")}</p>
      <div>
        <Button asChild size="lg">
          <Link href="/">{t("notfound.home")}</Link>
        </Button>
      </div>
    </main>
  );
}
