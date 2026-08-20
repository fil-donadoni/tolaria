import { useMemo } from "react";
import { computeDeckStats } from "~/lib/deckStats";
import type { ZoneCard } from "~/types/game";
import { Button } from "~/components/ui/button";
import DeckLegalityChip from "~/components/lobby/deck-builder/deck-legality-chip";
import DeckStatsButton from "./deck-stats-button";
import DeckMiniCurve from "./deck-mini-curve";
import DeckMiniPips from "./deck-mini-pips";
import type { DeckLegalitySpec, DeckSaveBarSpec } from "./deckBuilderVariant";

export interface DeckBottomBarProps {
    mainCards: ZoneCard[];
    sideCards: ZoneCard[];
    /** Tab labels, reused verbatim so the bar and the tabs never call the same
     *  list two different things (Limited's second zone is its Pool). */
    mainLabel: string;
    sideLabel: string;
    /** Opens the basics SHEET. Absent = this variant declares no basics bar,
     *  so no Lands button is rendered. */
    onOpenLands?: () => void;
    /** Leave + flush — the same action Back and Done have always been. */
    onDone: () => void;
    /** The variant's legality record, when it has one. In portrait this bar is
     *  legality's ONLY home: `DeckLegalityPanel` costs a permanent ~48px band
     *  the phone cannot spare and `SaveDeckBar` — whose `short-viewport:` row
     *  carried the chip — is REPLACED here, and its row only ever matched
     *  `(max-height: 500px)` (`index.css`), which 390x844 is not. Dropping
     *  both left a phone builder unable to learn its deck was illegal at all
     *  (PR #2641 review, blocker 3). Same `DeckLegalityChip` the short-viewport
     *  row uses: one static badge when legal, a popover of reasons when not,
     *  so it costs no height while closed. */
    legality?: DeckLegalitySpec;
    /** The variant's save-bar record, when it has one. Its name field moves
     *  into this bar in portrait, because `SaveDeckBar` itself is replaced
     *  here rather than stacked above (two bottom bands on a phone is the
     *  chrome budget issue #2511 spent a whole slice reclaiming). */
    saveBar?: DeckSaveBarSpec;
}

/**
 * The phone-portrait BOTTOM BAR (issue #2584, PRD #2405 slice 5, ADR 0101).
 *
 * Two rows, in the order the issue lists them:
 *
 *  1. counts, colour pips, a mini mana curve and the legality chip — the
 *     things a builder checks constantly and would otherwise have to open a
 *     dialog (or a wider viewport) for;
 *  2. the deck name, then Lands / Stats / Done.
 *
 * It REPLACES `SaveDeckBar` in portrait rather than sitting above it, and
 * therefore carries everything that bar carried (name, card count, Delete,
 * Done) — a phone cannot afford two bottom bands, and losing the rename
 * affordance to a layout change would be a silent regression.
 *
 * Statistics are computed from the Maindeck by `computeDeckStats`
 * (`src/lib/deckStats.ts`) — the SAME function the Stats dialog uses, so the
 * glanceable summary and the full read can never disagree.
 */
export default function DeckBottomBar({
    mainCards,
    sideCards,
    mainLabel,
    sideLabel,
    onOpenLands,
    onDone,
    legality,
    saveBar,
}: DeckBottomBarProps) {
    const stats = useMemo(() => computeDeckStats(mainCards), [mainCards]);

    return (
        <div
            data-deck-bottom-bar
            className="flex shrink-0 flex-col gap-1 border-t border-border-subtle/30 bg-surface/80 px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
        >
            <div className="flex items-center gap-2 overflow-x-auto text-[0.6875rem] text-text-muted">
                <span className="shrink-0 font-semibold text-parchment">
                    {mainLabel} {mainCards.length}
                </span>
                <span className="shrink-0">
                    {sideLabel} {sideCards.length}
                </span>
                <DeckMiniPips pips={stats.pips} />
                <DeckMiniCurve curve={stats.curve} />
                {legality && (
                    <div className="ml-auto shrink-0">
                        <DeckLegalityChip
                            formatLabel={legality.formatLabel}
                            isLegal={legality.isLegal}
                            reasons={legality.reasons}
                        />
                    </div>
                )}
            </div>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    onDone();
                }}
                className="flex items-center gap-1.5"
            >
                {saveBar && (
                    <input
                        type="text"
                        value={saveBar.name}
                        onChange={(e) => saveBar.onChangeName(e.target.value)}
                        placeholder="Deck name"
                        aria-label="Deck name"
                        style={{ minHeight: "var(--control-h)" }}
                        className="input-field min-w-0 flex-1 px-2 py-1 text-xs"
                    />
                )}
                {onOpenLands && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        style={{ minHeight: "var(--control-h)" }}
                        onClick={onOpenLands}
                    >
                        Lands
                    </Button>
                )}
                <DeckStatsButton
                    mainCards={mainCards}
                    className="min-h-[var(--control-h)] px-2 py-1 text-xs"
                />
                {saveBar?.onDelete && (
                    <Button
                        type="button"
                        variant="destructive"
                        size="xs"
                        style={{ minHeight: "var(--control-h)" }}
                        onClick={saveBar.onDelete}
                    >
                        Delete
                    </Button>
                )}
                <Button
                    type="submit"
                    variant="primary"
                    size="xs"
                    style={{ minHeight: "var(--control-h)" }}
                >
                    Done
                </Button>
            </form>
        </div>
    );
}
