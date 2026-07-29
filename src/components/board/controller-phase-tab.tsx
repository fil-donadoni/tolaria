import { Flag } from "lucide-react";
import type { Phase } from "@convex/gre/types";
import { phaseGroupShort, phaseShort } from "~/lib/phase-labels";
import ControllerTabButton from "./controller-tab-button";

type ControllerPhaseTabProps = {
    phase: Phase;
    turn: number;
    /** Whether the phase sheet (the full step list) is currently open. */
    open: boolean;
    onToggle: () => void;
};

/** The "Phase" tab of the portrait bottom bar (#1818, extracted per the
 *  issue's target-file split from `controller-bottom-bar.tsx`).
 *
 *  **Problem.** Before #1818 the tab's ONLY text was the compact
 *  `T{turn}·{phaseShort(phase)}` string (#1815 review fixup round 3, e.g.
 *  "T1·DA") sitting under a static {@link Flag} glyph that never changed. The
 *  five combat sub-steps WERE technically distinct (`phaseShort` is pairwise
 *  distinct across the whole turn, `phase-labels.test.ts`), but only as a
 *  2-letter code buried inside a 5-character compound string at 9px — a
 *  player has to already know "DA means Declare Attackers" to read it, which
 *  is exactly the "T2-COMBAT, can't tell which combat step" complaint #1818
 *  opened against.
 *
 *  **Fix — mirror the desktop pod's caption/value split (`controller-pod.tsx`),
 *  compacted to fit the tab's ~53-65px column.** The pod shows a small
 *  `T{turn} · {phaseGroupLabel}` caption ABOVE a full-word, prominent
 *  `phaseLabel(phase)` value ("Declare Attackers") — the pod has the width for
 *  the whole word. The tab does not (see `controller-bottom-bar.tsx`'s module
 *  doc comment for the ~7-char/9px budget that forced #1815's abbreviation in
 *  the first place), so it mirrors the SAME two-tier structure using the
 *  `short` codes the phase-labels source already exports for exactly this
 *  squeeze:
 *
 *  - **Value (top, replaces the static Flag glyph, prominent).**
 *    `phaseShort(phase)` at `text-xs font-bold` (12px) instead of buried at
 *    9px inside a compound string — this is the element that now visibly
 *    differs across all 5 combat sub-steps (DA/DB/FD/CD/EC, plus BC for
 *    Beginning of Combat), legible at a glance rather than requiring the
 *    reader to parse a `T1·XX` string first.
 *  - **Caption (bottom, the pre-existing 9px `label` slot).**
 *    `T{turn}·{phaseGroupShort(phase)}` (e.g. "T1·COM") — `phaseGroupShort` is
 *    a NEW phase-labels export (#1818) but is a generic derivation of the
 *    already-shared `phaseGroupLabel`, not a new hardcoded phase string. Every
 *    combat sub-step shares "COM" here by design: disambiguating the STEP is
 *    the value row's job now, this row's job is "which broad group, which
 *    turn" — same information the pre-#1818 caption carried, just freed of
 *    the step code it handed up to the value row.
 *
 *  **Char/px budget, unchanged from #1815's numbers.** The caption
 *  `T{turn}·{phaseGroupShort}` is at most 7 characters ("T10·BEG" for a
 *  double-digit turn) — the same ~7-char ceiling #1815 measured for this 9px
 *  slot at the 320px floor, so it neither overflows nor wraps. The value row
 *  is at most 2 characters — trivially inside any width this tab can have.
 *  Total stacked height is the icon's `h-[1.1rem]`+`gap-0.5`+9px caption
 *  budget it replaces (`ControllerTabButton`'s fixed `h-[3.25rem]` cell is
 *  untouched), so the bar's height does not change.
 *
 *  The full-word `phaseLabel(phase)` ("Declare Attackers") stays reachable
 *  from the phase sheet this tab opens (`controller-phase-row.tsx`) and the
 *  desktop pod — this tab is the space-constrained collapsed surface, not a
 *  second full copy of the sheet. */
export default function ControllerPhaseTab({
    phase,
    turn,
    open,
    onToggle,
}: ControllerPhaseTabProps) {
    return (
        <ControllerTabButton
            label={`T${turn}·${phaseGroupShort(phase)}`}
            ariaLabel="Toggle phase list"
            ariaExpanded={open}
            active={open}
            onClick={onToggle}
        >
            <span
                data-controller-phase-step
                className="flex items-center gap-1 leading-none"
            >
                <Flag className="h-3 w-3 shrink-0" aria-hidden />
                <span className="text-xs font-bold uppercase tracking-wide">
                    {phaseShort(phase)}
                </span>
            </span>
        </ControllerTabButton>
    );
}
