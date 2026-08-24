import { ReviewStatus } from "@/lib/types";
import { CheckIcon, ClockIcon, CloseIcon } from "@/components/icons";

const STYLES: Record<ReviewStatus, string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-300",
  approved: "bg-emerald-50 text-emerald-800 border-emerald-300",
  rejected: "bg-rose-50 text-rose-800 border-rose-300",
};

const LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const ICONS: Record<ReviewStatus, (props: { className?: string }) => React.ReactElement> = {
  pending: ClockIcon,
  approved: CheckIcon,
  rejected: CloseIcon,
};

/**
 * Status is carried by three signals, not one: an icon, a word, and a colour. Colour
 * alone would be invisible to a colour-blind user and to a screen reader; the icon
 * shape distinguishes the three states even in greyscale.
 */
export function StatusBadge({ status }: { status: ReviewStatus }) {
  const Icon = ICONS[status];

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {LABELS[status]}
    </span>
  );
}
