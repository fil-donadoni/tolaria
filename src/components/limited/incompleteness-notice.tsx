import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";

interface IncompletenessNoticeProps {
    /** The currently-selected Pack Source's live Draftability info (from
     *  `listLimitedDraftableSets`), or `undefined` while nothing is
     *  selectable yet. */
    set: DraftableSetInfo | undefined;
}

/** Incompleteness Notice (ADR 0059, PRD #1241/#1242): shown under the Pack
 *  Source selector for any CHOSEN set below 100% implementation — an honest
 *  disclosure that some of its Booster Sheets' cards have no implemented
 *  `CardDefinition` yet and are dropped from the print run at runtime
 *  (weights renormalized, never a placeholder). Renders nothing once the set
 *  reaches 100% (`missingCardCount === 0`) or while no set is selected — no
 *  manual upkeep, it tracks whatever `listLimitedDraftableSets` reports off
 *  the live registry. */
export default function IncompletenessNotice({
    set,
}: IncompletenessNoticeProps) {
    if (!set || set.missingCardCount === 0) return null;

    return (
        <p
            role="status"
            className="rounded-sm border border-accent/40 bg-accent-soft/40 px-2 py-1.5 text-xs text-text"
        >
            <span className="font-semibold uppercase tracking-wide text-accent-strong">
                Incompleteness Notice
            </span>
            {" — "}
            {set.setCode.toUpperCase()} is missing {set.missingCardCount} card
            {set.missingCardCount === 1 ? "" : "s"} with no implemented
            definition yet. They are dropped from the print run and every
            Booster Sheet's weights are renormalized, so no booster ever shows a
            placeholder.
        </p>
    );
}
