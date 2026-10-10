// PROTOTYPE — throwaway. Variant C — "MTGO grid": deck and sideboard are
// each ONE combined pile grid, columns by mana value / colour, a straight
// divider between the creature and non-creature stacks inside every column.
// On a phone the grid is a single horizontal scroller (the divider label
// stays pinned left); portrait draws smaller cards to show more columns.
import BasicsStrip from "./basics-strip";
import BuilderFrame from "./builder-frame";
import BuilderPanel from "./builder-panel";
import BuilderToolbar from "./builder-toolbar";
import MtgoCombinedGrid from "./mtgo-combined-grid";
import { useBuilder } from "./useBuilder";
import { useViewport } from "./useViewport";

export default function VariantCMtgoGrid() {
    const b = useBuilder();
    const vp = useViewport();
    const cardW = !vp.md && !vp.landscapePhone ? 60 : vp.cardW;
    const onCard = (c: (typeof b.deck)[number], el: Element) => b.move(c, el);
    const grid = (cards: typeof b.deck) => (
        <MtgoCombinedGrid
            cards={cards}
            groupBy={b.groupBy}
            sortBy={b.sortBy}
            filter={b.filter}
            onCardClick={onCard}
            showHeaders={!vp.landscapePhone}
        />
    );
    return (
        <BuilderFrame cardW={cardW} className="gap-3">
            <BuilderPanel>
                <BuilderToolbar b={b} compact={vp.landscapePhone} />
            </BuilderPanel>
            <div className="grid min-w-0 gap-3 min-[1180px]:grid-cols-[minmax(0,1fr)_340px]">
                <BuilderPanel className="flex min-w-0 flex-col gap-2">
                    <header className="flex items-baseline gap-2">
                        <h3 className="font-display text-sm tracking-wide text-parchment">
                            Deck
                        </h3>
                        <span className="text-[11px] tabular-nums text-text-muted">
                            {b.deck.length} spells · {b.basicsTotal} basics
                        </span>
                    </header>
                    {grid(b.deck)}
                </BuilderPanel>
                <BuilderPanel className="min-[1180px]:self-start">
                    <BasicsStrip
                        b={b}
                        compact={vp.landscapePhone}
                        vertical={vp.lg}
                    />
                </BuilderPanel>
            </div>
            <BuilderPanel className="flex min-w-0 flex-col gap-2 bg-surface-base/30">
                <header className="flex items-baseline gap-2">
                    <h3 className="font-display text-sm tracking-wide text-parchment">
                        Sideboard
                    </h3>
                    <span className="text-[11px] tabular-nums text-text-muted">
                        {b.side.length}
                    </span>
                    <span className="ml-auto text-[11px] text-text-disabled">
                        Tap a card to move it
                    </span>
                </header>
                {grid(b.side)}
            </BuilderPanel>
        </BuilderFrame>
    );
}
