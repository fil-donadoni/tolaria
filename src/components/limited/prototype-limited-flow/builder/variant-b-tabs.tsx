// PROTOTYPE — throwaway. Variant B — "Tabs on phone": a phone in portrait
// gets segmented tabs Creatures / Non-creatures / Sideboard (one zone at a
// time, piles wrapping — no sideways scroll). A phone in landscape shows the
// two deck rows SIDE BY SIDE, compressed, each its own scroller. From md up
// the full MTGO split: creature row over non-creature row, sideboard below.
import { useState } from "react";
import type { ProtoCard } from "../proto-cards";
import { buildColumns, isCreature } from "./builder-data";
import BasicsStrip from "./basics-strip";
import BuilderFrame from "./builder-frame";
import BuilderPanel from "./builder-panel";
import BuilderToolbar from "./builder-toolbar";
import PileRow from "./pile-row";
import ZoneTabs, { type ZoneTab } from "./zone-tabs";
import { useBuilder } from "./useBuilder";
import { useViewport } from "./useViewport";

export default function VariantBTabs() {
    const b = useBuilder();
    const vp = useViewport();
    const [tab, setTab] = useState<ZoneTab>("creatures");
    const phonePortrait = !vp.md && !vp.landscapePhone;
    // On a phone the tabs ARE the creature filter.
    const deck = phonePortrait ? b.deck : b.deck.filter(b.passesFilter);
    const side = phonePortrait ? b.side : b.side.filter(b.passesFilter);
    const creatures = deck.filter(isCreature);
    const spells = deck.filter((c) => !isCreature(c));
    const cols = (cards: ProtoCard[]) =>
        buildColumns(cards, b.groupBy, b.sortBy);
    // A card leaving the visible tab flies to the destination tab's pill.
    const onCard = (c: ProtoCard, el: Element) =>
        b.move(c, el, (to) =>
            phonePortrait
                ? `[data-fly-tab="${to === "side" ? "side" : isCreature(c) ? "creatures" : "spells"}"]`
                : undefined
        );

    const sideRow = (
        <PileRow
            title="Sideboard"
            count={side.length}
            accent="side"
            columns={cols(side)}
            onCardClick={onCard}
            scroll={!phonePortrait}
            showHeaders={!vp.landscapePhone}
            empty="Sideboard is empty"
        />
    );

    if (phonePortrait) {
        const current =
            tab === "creatures"
                ? {
                      title: "Creatures",
                      cards: creatures,
                      accent: "creature" as const,
                  }
                : {
                      title: "Non-creatures",
                      cards: spells,
                      accent: "spell" as const,
                  };
        return (
            <BuilderFrame cardW={vp.cardW} className="gap-3">
                <BuilderPanel>
                    <BuilderToolbar b={b} showFilter={false} />
                </BuilderPanel>
                <BuilderPanel>
                    <BasicsStrip b={b} />
                </BuilderPanel>
                <ZoneTabs
                    value={tab}
                    onChange={setTab}
                    tabs={[
                        {
                            key: "creatures",
                            label: "Creatures",
                            count: creatures.length,
                        },
                        {
                            key: "spells",
                            label: "Non-creatures",
                            count: spells.length,
                        },
                        { key: "side", label: "Sideboard", count: side.length },
                    ]}
                />
                <BuilderPanel>
                    {tab === "side" ? (
                        sideRow
                    ) : (
                        <PileRow
                            title={current.title}
                            count={current.cards.length}
                            accent={current.accent}
                            columns={cols(current.cards)}
                            onCardClick={onCard}
                            scroll={false}
                        />
                    )}
                </BuilderPanel>
            </BuilderFrame>
        );
    }

    if (vp.landscapePhone) {
        return (
            <BuilderFrame cardW={50} className="gap-2">
                <BuilderPanel className="p-2 sm:p-2">
                    <BuilderToolbar b={b} compact />
                </BuilderPanel>
                <BuilderPanel className="p-2 sm:p-2">
                    <BasicsStrip b={b} compact />
                </BuilderPanel>
                <BuilderPanel className="grid grid-cols-2 gap-3 p-2 sm:p-2">
                    <PileRow
                        title="Creatures"
                        count={creatures.length}
                        accent="creature"
                        columns={cols(creatures)}
                        onCardClick={onCard}
                        showHeaders={false}
                    />
                    <PileRow
                        title="Non-creatures"
                        count={spells.length}
                        accent="spell"
                        columns={cols(spells)}
                        onCardClick={onCard}
                        showHeaders={false}
                        className="border-l border-border-subtle/40 pl-3"
                    />
                </BuilderPanel>
                <BuilderPanel className="bg-surface-base/30 p-2 sm:p-2">
                    {sideRow}
                </BuilderPanel>
            </BuilderFrame>
        );
    }

    return (
        <BuilderFrame cardW={vp.cardW} className="gap-3">
            <BuilderPanel>
                <BuilderToolbar b={b} />
            </BuilderPanel>
            <BuilderPanel>
                <BasicsStrip b={b} />
            </BuilderPanel>
            <BuilderPanel className="flex flex-col gap-4">
                {b.filter !== "non-creatures" && (
                    <PileRow
                        title="Creatures"
                        count={creatures.length}
                        accent="creature"
                        columns={cols(creatures)}
                        onCardClick={onCard}
                        scroll={false}
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
                        scroll={false}
                    />
                )}
            </BuilderPanel>
            <BuilderPanel className="bg-surface-base/30">
                {sideRow}
            </BuilderPanel>
        </BuilderFrame>
    );
}
