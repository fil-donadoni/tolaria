// Generic per-term score breakdown with provenance (issue #1612 acceptance:
// "capabilityFit +0.8 ← provides value-on-death; required by Flash (pick 4).
// Numbers without provenance are not enough"). Renders whatever terms
// `PickCandidateTrace.terms` carries — no per-term name is hardcoded here —
// so a future scorer term (Archetype/Capability/Combo Edge, PRD #1607 slice
// 4) appears automatically with zero Draft Lab code change, exactly the
// generic-rendering requirement the issue calls out.
import type { PickTerm } from "@convex/limited/botDrafter";

/** `+0.80` / `-0.12` / `+0.00` — always signed, so a zero-value term (e.g. a
 *  colourless card's `colourCommitment`) reads as "computed, contributed
 *  nothing" rather than looking absent. */
function signed(n: number): string {
    const rounded = Math.round(n * 100) / 100;
    return rounded >= 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2);
}

export default function DraftLabTermBreakdown({
    terms,
}: {
    terms: readonly PickTerm[];
}) {
    return (
        <ul className="flex flex-col gap-1">
            {terms.map((term) => (
                <li key={term.term} className="text-[11px] leading-tight">
                    <span className="font-semibold text-text">{term.term}</span>{" "}
                    <span
                        className={
                            term.value < 0
                                ? "text-signal-opponent"
                                : "text-signal-self"
                        }
                    >
                        {signed(term.value)}
                    </span>{" "}
                    <span className="text-text-muted">← {term.note}</span>
                    {term.sources.length > 0 && (
                        <ul className="mt-0.5 ml-3 flex flex-col gap-0.5">
                            {term.sources.map((source) => (
                                <li
                                    key={source.cardId}
                                    className="text-[10px] text-text-disabled"
                                >
                                    {source.cardId} ({source.reason})
                                </li>
                            ))}
                        </ul>
                    )}
                </li>
            ))}
        </ul>
    );
}
