import { ProductFootprint } from "@/lib/types";
import { WarningIcon } from "@/components/icons";

/**
 * Flags a submission as an emissions hotspot.
 *
 * The decision is the API's: `isHighRisk` is computed server-side from the domain
 * thresholds (>= 500 kg CO2e per unit, or >= 25% uncertainty). This component only
 * renders it, so the badge and the `highRiskOnly` queue filter cannot disagree.
 *
 * The API field is named for the review property it measures; the label uses "hotspot",
 * which is what the business calls the same thing.
 */
export function RiskFlag({ footprint }: { footprint: ProductFootprint }) {
  if (!footprint.isHighRisk) return null;

  return (
    <span
      title="Large emissions figure or wide uncertainty band — review carefully"
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
    >
      <WarningIcon className="h-3.5 w-3.5" />
      Hotspot
    </span>
  );
}
