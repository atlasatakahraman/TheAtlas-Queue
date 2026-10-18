"use client";
import { useIsMobile } from "@/components/use-client-state";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// A Dialog on desktop, a bottom Sheet under 768px (DESIGN.md § Mobile). returnFocus is where focus
// goes on close for a dialog opened without a trigger of its own (Custom pick, from a Select item
// that is gone by then), which would otherwise leave focus on <body>.
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const mobile = useIsMobile();
  const closeFocus = returnFocus && {
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      returnFocus.current?.focus();
    },
  };
  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" {...closeFocus} {...(description ? {} : { "aria-describedby": undefined })} className="max-h-[90dvh] gap-4 rounded-t-2xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] [&_[data-slot=sheet-close]]:size-11">
          <SheetHeader className="p-0">
            <SheetTitle className="font-serif text-title font-normal">{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          {children}
          {footer && <SheetFooter className="flex-row justify-end gap-2 p-0">{footer}</SheetFooter>}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 rounded-2xl p-6 sm:max-w-md" {...closeFocus} {...(description ? {} : { "aria-describedby": undefined })}>
        <DialogHeader>
          <DialogTitle className="font-serif text-title font-normal">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
