import type { Severity } from "@/lib/types.ts";
import { severityLabel } from "@/lib/risk.ts";

export function RiskPill({ risk, count }: { risk: Severity; count?: number }) {
  return (
    <span className={`pill ${risk}`}>
      {count !== undefined ? `${count} ${severityLabel(risk).toLowerCase()}` : severityLabel(risk)}
    </span>
  );
}
