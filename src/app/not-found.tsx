import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { StatusPage, StatusRow } from "@/components/status-page";
import { Button } from "@/components/ui/button";
import { LANG_COOKIE, parseLang, translate } from "@/lib/i18n";

export const metadata: Metadata = { title: "404", robots: { index: false, follow: false } };

// An empty slot numbered 404 (DESIGN.md § Not found and errors).
export default async function NotFound() {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
  return (
    <StatusPage>
      <StatusRow
        kind="missing"
        mark="404"
        title={t("notfound.title")}
        hint={t("notfound.hint")}
        actions={
          <Button asChild size="lg" variant="outline">
            <Link href="/">{t("notfound.home")}</Link>
          </Button>
        }
      />
    </StatusPage>
  );
}
