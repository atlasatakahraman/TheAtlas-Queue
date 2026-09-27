"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { PrefsSync } from "@/components/prefs";
import { TooltipProvider } from "@/components/ui/tooltip";

interface ProvidersProps {
  children: React.ReactNode;
  nonce?: string;
}

export function Providers({ children, nonce }: ProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange={false} nonce={nonce}>
      <TooltipProvider delayDuration={200}>
        {children}
        <PrefsSync />
        {/* DESIGN.md § Toasts: bottom-centre, at most three, on the popover surface. */}
        <Toaster
          className="select-none"
          position="bottom-center"
          visibleToasts={3}
          swipeDirections={["bottom"]}
          toastOptions={{
            classNames: {
              toast: "bg-popover! text-popover-foreground! border-row-edge! rounded-xl! shadow-lg font-sans text-control",
              title: "text-foreground font-medium",
              description: "text-muted-foreground",
              actionButton: "bg-primary! text-primary-foreground! rounded-lg! font-medium",
              error: "text-destructive!",
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
