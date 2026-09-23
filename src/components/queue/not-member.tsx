"use client";
import Link from "next/link";
import { useT } from "@/components/i18n";
import { Button } from "@/components/ui/button";

// /c/<slug> for someone who is not (or no longer) a member, or a slug that does not exist:
// the two look the same, so a dashboard's existence is not revealed.
export function NotMember() {
  const { t } = useT();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-16">
      <h1 className="font-serif text-title">{t("access.none.title")}</h1>
      <p className="text-muted-foreground">{t("access.none.hint")}</p>
      <div>
        <Button asChild size="lg">
          <Link href="/">{t("access.none.link")}</Link>
        </Button>
      </div>
    </main>
  );
}
