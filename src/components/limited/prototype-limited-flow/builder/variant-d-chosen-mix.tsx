// PROTOTYPE — throwaway. Variant D — the owner's chosen mix, per viewport,
// with "Split creatures" as a visible OPTION (default OFF; the All /
// Creatures / Non-creatures filter stays separate):
//   desktop    ON  → C's MTGO grid with the creature divider
//              OFF → one pile per mana-value / colour column, no divider
//   portrait   ON  → B's tabs Creatures / Non-creatures / Sideboard
//              OFF → tabs Deck / Sideboard, Deck = one wrapping pile grid
//   landscape  ON  → B's two rows side by side
//              OFF → one sideways-scrolling deck row, sideboard strip below
import { useState } from "react";
import type { ProtoCard } from "../proto-cards";
import { buildColumns, isCreature } from "./builder-data";
import BasicsStrip from "./basics-strip";
import BuilderFrame from "./builder-frame";
import BuilderPanel from "./builder-panel";
import BuilderToolbar from "./builder-toolbar";
import MtgoCombinedGrid from "./mtgo-combined-grid";
import PileRow from "./pile-row";
import ZoneTabs, { type ZoneTab } from "./zone-tabs";
import { useBuilder } from "./useBuilder";
import { useViewport } from "./useViewport";

export default function VariantDChosenMix() {
    const b = useBuilder();
    const vp = useViewport();
    const [tab, setTab] = useState<ZoneTab>(b.split ? "creatures" : "deck");
    const phonePortrait = !vp.md && !vp.landscapePhone;
    const desktop = vp.md;
    // Portrait + split: the tabs ARE the creature filter.
    const tabsReplaceFilter = phonePortrait && b.split;
    const deck = tabsReplaceFilter ? b.deck : b.deck.filter(b.passesFilter);
    const side = tabsReplaceFilter ? b.side : b.side.filter(b.passesFilter);
    const creatures = deck.filter(isCreature);
    const spells = deck.filter((c) => !isCreature(c));
    const cols = (cards: ProtoCard[]) =>
        buildColumns(cards, b.groupBy, b.sortBy);

    // The tab a card lands in, for the fly fallback when it is hidden.
    const tabFor = (c: ProtoCard, toSide: boolean): ZoneTab =>
        toSide
            ? "side"
            : !b.split
              ? "deck"
              : isCreature(c)
                ? "creatures"
                : "spells";
    const onCard = (c: ProtoCard, el: Element) =>
        b.move(c, el, (to) =>
            phonePortrait
                ? `[data-fly-tab="${tabFor(c, to === "side")}"]`
                : undefined
        );
    // Switching the split on a phone keeps the tab meaningful.
    const setSplit = (on: boolean) => {
        b.setSplit(on);
        setTab((t) => (t === "side" ? "side" : on ? "creatures" : "deck"));
    };
    const bb = { ...b, setSplit };

    if (phonePortrait) {
        const tabs = b.split
            ? [
                  {
                      key: "creatures" as const,
                      label: "Creatures",
                      count: creatures.length,
                  },
                  {
                      key: "spells" as const,
                      label: "Non-creatures",
                      count: spells.length,
                  },
                  {
                      key: "side" as const,
                      label: "Sideboard",
                      count: side.length,
                  },
              ]
            : [
                  { key: "deck" as const, label: "Deck", count: deck.length },
                  {
                      key: "side" as const,
                      label: "Sideboard",
                      count: side.length,
                  },
              ];
        const view =
            tab === "side"
                ? { title: "Sideboard", cards: side, accent: "side" as const }
                : tab === "spells"
                  ? {
                        title: "Non-creatures",
                        cards: spells,
                        accent: "spell" as const,
                    }
                  : tab === "creatures"
                    ? {
                          title: "Creatures",
                          cards: creatures,
                          accent: "creature" as const,
                      }
                    : { title: "Deck", cards: deck, accent: "side" as const };
        return (
            <BuilderFrame cardW={vp.cardW} className="gap-3">
                <BuilderPanel>
                    <BuilderToolbar b={bb} showSplit showFilter={!b.split} />
                </BuilderPanel>
                <BuilderPanel>
                    <BasicsStrip b={b} />
                </BuilderPanel>
                <ZoneTabs value={tab} onChange={setTab} tabs={tabs} />
                <BuilderPanel>
                    <PileRow
                        title={view.title}
                        count={view.cards.length}
                        accent={view.accent}
                        columns={cols(view.cards)}
                        onCardClick={onCard}
                        scroll={false}
                        empty={
                            tab === "side"
                                ? "Sideboard is empty"
                                : "Nothing here"
                        }
                    />
                </BuilderPanel>
            </BuilderFrame>
        );
    }

    if (!desktop) {
        // Landscape phone.
        return (
            <BuilderFrame cardW={50} className="gap-2">
                <BuilderPanel className="p-2 sm:p-2">
                    <BuilderToolbar b={bb} compact showSplit />
                </BuilderPanel>
                <BuilderPanel className="p-2 sm:p-2">
                    <BasicsStrip b={b} compact />
                </BuilderPanel>
                {b.split ? (
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
                ) : (
                    <BuilderPanel className="p-2 sm:p-2">
                        <PileRow
                            title="Deck"
                            count={deck.length}
                            accent="side"
                            columns={cols(deck)}
                            onCardClick={onCard}
                        />
                    </BuilderPanel>
                )}
                <BuilderPanel className="bg-surface-base/30 p-2 sm:p-2">
                    <PileRow
                        title="Sideboard"
                        count={side.length}
                        accent="side"
                        columns={cols(side)}
                        onCardClick={onCard}
                        showHeaders={false}
                        empty="Sideboard is empty"
                    />
                </BuilderPanel>
            </BuilderFrame>
        );
    }

    const grid = (cards: ProtoCard[]) => (
        <MtgoCombinedGrid
            cards={cards}
            groupBy={b.groupBy}
            sortBy={b.sortBy}
            filter={b.filter}
            onCardClick={onCard}
            split={b.split}
        />
    );
    // Split ON dims the filtered half; OFF has no halves, so it hides.
    const shown = (cards: ProtoCard[]) =>
        b.split ? cards : cards.filter(b.passesFilter);
    return (
        <BuilderFrame cardW={vp.cardW} className="gap-3">
            <BuilderPanel>
                <BuilderToolbar b={bb} showSplit />
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
                    {grid(shown(b.deck))}
                </BuilderPanel>
                <BuilderPanel className="min-[1180px]:self-start">
                    <BasicsStrip b={b} vertical={vp.lg} />
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
                {grid(shown(b.side))}
            </BuilderPanel>
        </BuilderFrame>
    );
}
