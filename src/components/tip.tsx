"use client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// A tooltip on a control, which also works while the control is disabled (D25: a disabled control
// says why). A disabled button takes no pointer events, so the tooltip sits on a wrapper span.
export function Tip({ label, children, side }: {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}) {
  // No label, no tooltip: the control renders as it is.
  if (!label) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
