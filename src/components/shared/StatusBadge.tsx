import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  Radio,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

const statusConfig: Record<
  string,
  {
    icon: typeof CheckCircle2;
    className: string;
    label: string;
  }
> = {
  finalized: {
    icon: ShieldCheck,
    label: "Finalized",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  simulated: {
    icon: Radio,
    label: "Simulated",
    className: "border-indigo-400/30 bg-indigo-400/10 text-indigo-200",
  },
  confirmed: {
    icon: CheckCircle2,
    label: "Confirmed",
    className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  },
  processed: {
    icon: CircleDot,
    label: "Processed",
    className: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  },
  submitted: {
    icon: Send,
    label: "Submitted",
    className: "border-slate-300/25 bg-slate-300/10 text-slate-200",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    className: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  },
  healthy: {
    icon: ShieldCheck,
    label: "Healthy",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  optimal: {
    icon: ShieldCheck,
    label: "Optimal",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  degraded: {
    icon: AlertTriangle,
    label: "Degraded",
    className: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  },
  congested: {
    icon: Radio,
    label: "Congested",
    className: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  },
  success: {
    icon: CheckCircle2,
    label: "Success",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  info: {
    icon: Clock3,
    label: "Info",
    className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  },
  warning: {
    icon: AlertTriangle,
    label: "Warning",
    className: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  },
  danger: {
    icon: XCircle,
    label: "Danger",
    className: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  },
  neutral: {
    icon: CircleDot,
    label: "Neutral",
    className: "border-white/15 bg-white/5 text-slate-200",
  },
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.neutral;
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn("h-6 rounded-md px-2 font-mono text-[11px]", config.className, className)}
    >
      <Icon className="size-3" />
      {label ?? config.label}
    </Badge>
  );
}
