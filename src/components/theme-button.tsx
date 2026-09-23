"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useT } from "@/components/i18n";
import { Button } from "@/components/ui/button";

// Mürekkep ↔ Kâğıt. The icon follows the .dark class in CSS, so the server render matches.
export function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useT();
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label={t("theme.toggle")}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="dark:hidden" aria-hidden />
      <Moon className="hidden dark:block" aria-hidden />
    </Button>
  );
}
