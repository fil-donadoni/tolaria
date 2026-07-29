import type { Phase } from "@convex/gre/types";
import { phaseCompact, phaseGroupShort, phaseLabel } from "~/lib/phase-labels";
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
 *  "T1·DA") sitting under a static `Flag` glyph that never changed. The five
 *  combat sub-steps WERE technically distinct (`phaseShort` is pairwise
 *  distinct across the whole turn, `phase-labels.test.ts`), but only as a
 *  2-letter code buried inside a 5-character compound string at 9px — a
 *  player has to already know "DA means Declare Attackers" to read it, which
 *  is exactly the "T2-COMBAT, can't tell which combat step" complaint #1818
 *  opened against.
 *
 *  **Fix, round 1 (superseded below) — mirror the desktop pod's caption/value
 *  split, still behind a 2-letter code.** The first cut of #1818 kept the
 *  static `Flag` glyph next to the promoted `phaseShort` value. Review
 *  fixup: the glyph added nothing (it never changed) while eating ~16px of
 *  the value row's width, AND a 2-letter code is still a code — "DA"/"DB"/
 *  "FD"/"CD" read exactly as cryptically at 12px as they did at 9px. Both
 *  are gone now.
 *
 *  **Fix, round 2 (review fixup) — drop the glyph, promote a READABLE WORD.**
 *  The value row now renders {@link phaseCompact} — "ATTACK", "BLOCK",
 *  "1ST DMG", "DAMAGE", etc. (`phase-labels.ts`'s `PhaseStep.compact`, the
 *  shared source both this tab and the phase sheet read) — at `text-xs
 *  font-bold` (12px), no icon. Removing the glyph frees the ~16px it used to
 *  occupy (icon + `gap-1`), which is what raises the value row's char budget
 *  from ~2 chars (a bare code needed no room) to ~7 chars @320px / ~8.5 @390px
 *  at this same 12px size — see `controller-bottom-bar.tsx`'s module doc
 *  comment for the per-char model this budget is measured against. Every
 *  `compact` value in the table is ≤7 characters and pairwise distinct
 *  (`phase-labels.test.ts`), so it fits without truncating at the 320px
 *  floor.
 *
 *  **Font size stays at 12px, not raised.** The longest `compact` values
 *  (`"1ST DMG"`, `"END CMB"`, `"CLEANUP"`) already sit exactly at the 7-char
 *  ceiling this budget affords at 12px — raising the size would shrink that
 *  ceiling below 7 and start truncating/overflowing those three. There is no
 *  slack to spend on a bigger font once the words (not just 2-char codes)
 *  are what's being sized.
 *
 *  **Caption (bottom, the pre-existing 9px `label` slot, unchanged).**
 *  `T{turn}·{phaseGroupShort(phase)}` (e.g. "T1·COM") — every combat
 *  sub-step shares "COM" here by design: disambiguating the STEP is the
 *  value row's job, this row's job is "which broad group, which turn".
 *
 *  **Accessibility — the granular phase reaches screen readers too (review
 *  fixup).** The button's own `aria-label` used to be the static "Toggle
 *  phase list" — a screen reader user got NONE of the granular step info the
 *  sighted value row now carries. It now reads
 *  `Turn {turn}, {phaseLabel(phase)}. Toggle phase list` — the SAME
 *  `phaseLabel` source the desktop pod and phase sheet use, so the
 *  accessible name and the visible step never drift apart.
 *
 *  **Char/px budget, caption unchanged from #1815's numbers.** The caption
 *  `T{turn}·{phaseGroupShort}` is at most 7 characters ("T10·BEG" for a
 *  double-digit turn). Total stacked height is the value row's `h-[1.1rem]`-
 *  equivalent line height + `gap-0.5` + the 9px caption budget
 *  (`ControllerTabButton`'s fixed `h-[3.25rem]` cell is untouched), so the
 *  bar's height does not change.
 *
 *  The full-word `phaseLabel(phase)` ("Declare Attackers") stays reachable
 *  from the phase sheet this tab opens (`controller-phase-row.tsx`, which
 *  now ALSO surfaces the `compact` word next to it — see that file's doc
 *  comment) and the desktop pod — this tab is the space-constrained
 *  collapsed surface, not a second full copy of the sheet. */
export default function ControllerPhaseTab({
    phase,
    turn,
    open,
    onToggle,
}: ControllerPhaseTabProps) {
    return (
        <ControllerTabButton
            label={`T${turn}·${phaseGroupShort(phase)}`}
            ariaLabel={`Turn ${turn}, ${phaseLabel(phase)}. Toggle phase list`}
            ariaExpanded={open}
            active={open}
            onClick={onToggle}
        >
            <span
                data-controller-phase-step
                className="flex items-center leading-none"
            >
                <span className="max-w-full truncate text-xs font-bold uppercase tracking-wide">
                    {phaseCompact(phase)}
                </span>
            </span>
        </ControllerTabButton>
    );
}
