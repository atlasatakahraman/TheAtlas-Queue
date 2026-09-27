"use client";
import { useEffect, useState } from "react";
import { useT } from "@/components/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Ask = { title: string; body: string; action: string };

let show: ((ask: Ask, resolve: (ok: boolean) => void) => void) | null = null;

// Bulk and moderation actions ask first, in the destructive look; Undo still follows in the toast
// (owner, 2026-09-27, amending D26). Resolves true without asking when no host is mounted.
export function confirm(ask: Ask): Promise<boolean> {
  return new Promise((resolve) => (show ? show(ask, resolve) : resolve(true)));
}

// Mounted once, in the dashboard.
export function ConfirmHost() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  // Kept after closing, so the dialog does not go blank while it animates out.
  const [ask, setAsk] = useState<Ask & { resolve: (ok: boolean) => void }>();
  useEffect(() => {
    show = (a, resolve) => {
      setAsk({ ...a, resolve });
      setOpen(true);
    };
    return () => {
      show = null;
    };
  }, []);
  // A promise settles once: the Action's true wins over the close that follows it.
  const close = (ok: boolean) => {
    ask?.resolve(ok);
    setOpen(false);
  };
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
          <AlertDialogDescription>{ask?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="lg">{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction size="lg" variant="destructive" onClick={() => close(true)}>
            {ask?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
