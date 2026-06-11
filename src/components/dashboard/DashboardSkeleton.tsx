import { SectionPanel } from "@/components/shared/SectionPanel";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
        <div className="space-y-3 border-b border-white/10 pb-5">
          <Skeleton className="h-6 w-32 bg-white/10" />
          <Skeleton className="h-10 w-60 bg-white/10" />
          <Skeleton className="h-4 w-full max-w-xl bg-white/10" />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <SectionPanel title="Network Status">
            <Skeleton className="h-48 w-full bg-white/10" />
          </SectionPanel>
          <SectionPanel title="AI Agent Decision">
            <Skeleton className="h-48 w-full bg-white/10" />
          </SectionPanel>
        </div>

        <SectionPanel title="Requirement Tracker">
          <Skeleton className="h-32 w-full bg-white/10" />
        </SectionPanel>
      </div>
    </div>
  );
}
