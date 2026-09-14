import { useId } from "react";
import DebugScenarioSpecField from "./debug-scenario-spec-field";
import { DEBUG_FIELD_GRID_CLASS } from "./debug-form-styles";
import type { SpecDraft } from "./scenario-draft";
import {
    isPerSeatSpecField,
    SCENARIO_SEATS,
    type SpecFieldSectionRows,
} from "./scenario-spec-ownership";

/**
 * ONE headed section of the scenario form's spec-level knobs (issue #3512):
 * a heading, then every row as an aligned label/value grid.
 *
 * The `me` / `opp` text is a COLUMN HEADER, printed once when the section holds
 * any per-seat row, rather than a sub-label repeated inside every pair — which
 * lengthened each row and was half of why the inputs zigzagged. Each input
 * keeps its own derived `aria-label`, so the header is visual only.
 */
export default function DebugScenarioSpecSection({
    rows,
    draft,
    onPatch,
}: {
    rows: SpecFieldSectionRows;
    draft: SpecDraft;
    onPatch: (patch: Partial<SpecDraft>) => void;
}) {
    const headingId = useId();
    const hasSeatColumns = rows.keys.some(isPerSeatSpecField);

    return (
        <section
            aria-labelledby={headingId}
            data-spec-section={rows.section}
            className="flex flex-col gap-1.5"
        >
            <h3 id={headingId} className="text-label">
                {rows.title}
            </h3>
            <div className={DEBUG_FIELD_GRID_CLASS}>
                {hasSeatColumns &&
                    SCENARIO_SEATS.map((seat, i) => (
                        <span
                            key={seat}
                            aria-hidden
                            data-seat-header={seat}
                            className={`${i === 0 ? "col-start-2" : ""} text-xs text-text-muted`}
                        >
                            {seat}
                        </span>
                    ))}
                {rows.keys.map((key) => (
                    <DebugScenarioSpecField
                        key={key}
                        fieldKey={key}
                        draft={draft}
                        onPatch={onPatch}
                    />
                ))}
            </div>
        </section>
    );
}
