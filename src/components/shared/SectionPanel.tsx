import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SectionPanelProps extends ComponentProps<"section"> {
  title?: string;
  description?: string;
  action?: ReactNode;
  contentClassName?: string;
}

export function SectionPanel({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
  ...props
}: SectionPanelProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-white/10 bg-card/80 text-card-foreground shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur",
        className
      )}
      {...props}
    >
      {(title || description || action) && (
        <div className="flex min-h-14 flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="text-sm font-semibold tracking-wide text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {action && (
            <div className="w-full min-w-0 max-w-full sm:w-auto sm:shrink">
              {action}
            </div>
          )}
        </div>
      )}
      <div className={cn("p-4 sm:p-5", contentClassName)}>{children}</div>
    </section>
  );
}
