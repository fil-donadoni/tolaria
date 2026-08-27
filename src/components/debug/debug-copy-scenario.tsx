import { useState } from "react";
import type { FullGameState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre/state";
import { specFromState } from "@convex/gre/scenarioBuilder";
import { copyMinified } from "~/lib/clipboard";
import DebugButton from "./debug-button";

/**
 * "Copy as scenario" (issue #2148) — the `ScenarioSpec` counterpart of "Copy
 * State": puts a card-NAME-based, blade-suite-ready spec on the clipboard
 * instead of the raw instance-id-keyed `GameState` dump, and shows what that
 * spec could NOT capture rather than leaving it as a silent gap (the whole
 * point of `specFromState`'s `dropped[]` — see `convex/gre/scenarioBuilder.ts`).
 *
 * `state` is the Debug panel's `getFullState` query result — the PROJECTED
 * admin view (`FullGameState`), not the raw engine `GameState`. The bridge
 * below is safe because `specFromState` only ever reads `.id` off a card's
 * `card` field (already `{ id }` on the wire, `convex/gameProjections.ts`
 * `slimCard`) and every other field it reads is carried through unchanged.
 * The ONE thing the wire boundary genuinely erases is `knownTo` (ADR 0026 —
 * never crosses the wire, even in this full debug view), which is how a
 * face-down EXILED card's hidden status is recorded; that specific fact is
 * appended to the notice below rather than silently missing.
 */
export default function DebugCopyScenario({
    state,
    mySeatId,
}: {
    state: FullGameState | null | undefined;
    mySeatId: string;
}) {
    const [copyFeedback, setCopyFeedback] = useState(false);
    const [dropped, setDropped] = useState<string[] | null>(null);

    const handleClick = () => {
        if (!state) return;
        const { spec, dropped: fromState } = specFromState(
            state as unknown as GameState,
            { mySeatId }
        );
        const notice = spec.cards.some((c) => c.zone === "exile")
            ? [
                  ...fromState,
                  `face-down-exile status isn't recoverable from this client view (knownTo is stripped before the wire, even in the full debug view) — check exile card(s) by hand if any should carry "faceDownExile"`,
              ]
            : fromState;
        setDropped(notice);
        void copyMinified(spec);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 1500);
    };

    return (
        <div className="flex flex-col gap-1">
            <DebugButton onClick={handleClick} disabled={!state}>
                {copyFeedback ? "Copied!" : "Copy as scenario"}
            </DebugButton>
            {dropped && dropped.length > 0 && (
                <div className="max-w-xs rounded-sm border border-border-subtle bg-surface-base/60 p-1.5 text-[10px]">
                    <div className="font-semibold text-danger-strong">
                        Not captured ({dropped.length}):
                    </div>
                    <ul className="ml-3 list-disc text-text-muted">
                        {dropped.map((note, i) => (
                            <li key={i}>{note}</li>
                        ))}
                    </ul>
                </div>
            )}
            {dropped && dropped.length === 0 && (
                <div className="text-[10px] text-text-disabled">
                    Nothing dropped — the scenario is a faithful capture of this
                    position.
                </div>
            )}
        </div>
    );
}
