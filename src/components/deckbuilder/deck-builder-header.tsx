import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import CompactChromeDisclosure from "./compact-chrome-disclosure";

export interface DeckBuilderHeaderProps {
    title: string;
    backLabel: string;
    onBack: () => void;
    /** Row-1 controls beyond Back + title. Presence flips `carriesControls`
     *  below — use this for a control the band must stay visible to keep
     *  reachable at every height. */
    actions?: ReactNode;
    /** A row-1 control that renders next to `actions` at a normal viewport
     *  but does NOT flip `carriesControls` (issue #1631/#2056 fixup):
     *  when it is the ONLY thing beyond Back + title, the band still hides
     *  under `short-viewport:` exactly as a bare Back+title band does, and
     *  this control disappears with it. Use this ONLY when the caller also
     *  reproduces the same affordance, compact, inside `SaveDeckBar`'s
     *  short-viewport row (the pattern `onBack`/`legality` already use
     *  there) — otherwise the control is genuinely lost, not folded. The
     *  Limited pool builder's Stats button is the reference case: issue
     *  #2056 hid that builder's header band specifically to hand its ~39px
     *  budget to the card zones (measured with ~4px of slack), so a control
     *  that forced the band to stay visible would reopen that regression. */
    foldableActions?: ReactNode;
    /** A full-width second row (the Constructed search filters). */
    filters?: ReactNode;
}

/**
 * The deckbuilder's header band — ONE band for every variant of
 * `DeckBuilderShell` (ADR 0075 §1, issue #1623). Back affordance and title are
 * fixed; everything else arrives through the two slots.
 *
 * **Short-viewport treatment is derived from the slots, not from the caller's
 * identity.** Under `short-viewport:` (`max-height: 500px`, issue #2056
 * defect 2) a band carrying nothing but Back + title HIDES entirely — both are
 * reproduced inside `SaveDeckBar`'s single row, so nothing is lost and the
 * band's ~39px goes to the cards. A band that also carries CONTROLS (search,
 * Format select, filters) cannot do that without taking those controls off the
 * screen with it, so it compacts its padding and title instead. Reading that
 * off slot PRESENCE rather than off a `variant` prop is what keeps the rule
 * true for the third variant (the draft-time Pool's Grouping + Ordering bar,
 * ADR 0075 §6) without anyone revisiting it.
 *
 * `foldableActions` is deliberately excluded from `carriesControls` (issue
 * #1631 fixup): a control passed there is nice-to-have in the header but not
 * worth keeping the band on screen for, so it hides along with Back + title
 * and must be reproduced, compact, in `SaveDeckBar`'s short-viewport row.
 *
 * The band is a single wrapping flex row so the title's parent element IS the
 * band — the element whose short-viewport treatment the height tests assert.
 * `filters` takes `basis-full`, so it wraps onto its own line beneath.
 */
export default function DeckBuilderHeader({
    title,
    backLabel,
    onBack,
    actions,
    foldableActions,
    filters,
}: DeckBuilderHeaderProps) {
    const carriesControls = Boolean(actions || filters);
    return (
        <div
            data-deckbuilder-header=""
            className={cn(
                "flex flex-wrap items-center gap-3 border-b border-border-subtle/30 bg-surface/60 px-4 py-3 md:px-6",
                carriesControls
                    ? "short-viewport:gap-1 short-viewport:py-1"
                    : "short-viewport:hidden"
            )}
        >
            <Button variant="ghost" size="sm" onClick={onBack}>
                {backLabel}
            </Button>
            <h1 className="text-lg short-viewport:text-sm font-semibold font-beleren tracking-wide text-parchment">
                {title}
            </h1>
            {actions}
            {foldableActions}
            {/* Issue #2511: the filter row is the single tallest band on this
                screen at 390px wide — it wrapped to 287px of the 446px header,
                on a viewport whose chrome already exceeded 844px. On a
                phone-shaped viewport it folds behind its own toggle; on a
                desktop-shaped one `CompactChromeDisclosure` renders the row
                verbatim, with no toggle and no extra element. */}
            {filters && (
                <CompactChromeDisclosure label="Filters">
                    <div className="flex basis-full flex-wrap items-center gap-4">
                        {filters}
                    </div>
                </CompactChromeDisclosure>
            )}
        </div>
    );
}
