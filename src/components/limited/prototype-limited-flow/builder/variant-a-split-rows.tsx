// PROTOTYPE — throwaway. Variant A — "Split rows": the MTGO split as two
// stacked rows (creatures on top, non-creatures below) at EVERY width; on a
// phone each row is its own horizontal scroller, so the page only scrolls
// vertically. Sideboard is a third row. Hosts the draft-room fly demo.
import { buildColumns, isCreature } from "./builder-data";
import BasicsStrip from "./basics-strip";
import BuilderFrame from "./builder-frame";
import BuilderPanel from "./builder-panel";
import BuilderToolbar from "./builder-toolbar";
import DraftFlyDemo from "./draft-fly-demo";
import PileRow from "./pile-row";
import { useBuilder } from "./useBuilder";
import { useViewport } from "./useViewport";

export default function VariantASplitRows() {
    const b = useBuilder();
    const vp = useViewport();
    const deck = b.deck.filter(b.passesFilter);
    const side = b.side.filter(b.passesFilter);
    const creatures = deck.filter(isCreature);
    const spells = deck.filter((c) => !isCreature(c));
    const cols = (cards: typeof deck) =>
        buildColumns(cards, b.groupBy, b.sortBy);
    const onCard = (c: (typeof deck)[number], el: Element) => b.move(c, el);

    return (
        <BuilderFrame cardW={vp.cardW} className="gap-3">
            <BuilderPanel>
                <BuilderToolbar b={b} compact={vp.landscapePhone} />
            </BuilderPanel>
            <BuilderPanel>
                <BasicsStrip b={b} compact={vp.landscapePhone} />
            </BuilderPanel>
            <BuilderPanel className="flex flex-col gap-4">
                {b.filter !== "non-creatures" && (
                    <PileRow
                        title="Creatures"
                        count={creatures.length}
                        accent="creature"
                        columns={cols(creatures)}
                        onCardClick={onCard}
                        showHeaders={!vp.landscapePhone}
                        empty="No creatures in the deck"
                    />
                )}
                {b.filter === "all" && (
                    <div className="h-px bg-border-subtle/40" />
                )}
                {b.filter !== "creatures" && (
                    <PileRow
                        title="Non-creatures"
                        count={spells.length}
                        accent="spell"
                        columns={cols(spells)}
                        onCardClick={onCard}
                        showHeaders={!vp.landscapePhone}
                        empty="No non-creature spells in the deck"
                    />
                )}
            </BuilderPanel>
            <BuilderPanel className="bg-surface-base/30">
                <PileRow
                    title="Sideboard"
                    count={side.length}
                    accent="side"
                    columns={cols(side)}
                    onCardClick={onCard}
                    showHeaders={!vp.landscapePhone}
                    empty="Sideboard is empty"
                    aside={
                        <span className="text-[11px] text-text-disabled">
                            Tap a card to move it
                        </span>
                    }
                />
            </BuilderPanel>
            <DraftFlyDemo />
        </BuilderFrame>
    );
}
