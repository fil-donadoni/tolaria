// PROTOTYPE — throwaway. Local state for every builder variant: which zone
// each pool card is in, basics counts + chosen printing, grouping, the
// coupled default sort, the creature filter, the deck name. Moving a card
// launches the FLIP fly.
import { useMemo, useState } from "react";
import { getPrintedCardImageUrl } from "~/lib/images";
import type { ProtoCard } from "../proto-cards";
import {
    BASICS,
    DEFAULT_DECK_NAME,
    DEFAULT_SORT,
    INITIAL_BASICS,
    INITIAL_DECK,
    POOL,
    type BasicKey,
    type GroupBy,
    type SortBy,
    type TypeFilter,
} from "./builder-data";
import { useFly } from "./useFly";

export type Zone = "deck" | "side";

export function useBuilder() {
    const [inDeck, setInDeck] = useState<Set<string>>(
        () => new Set(INITIAL_DECK)
    );
    const [basics, setBasics] = useState(INITIAL_BASICS);
    const [printing, setPrinting] = useState<Record<BasicKey, string>>(
        () =>
            Object.fromEntries(
                BASICS.map((b) => [b.key, b.printings[0].id])
            ) as Record<BasicKey, string>
    );
    const [groupBy, setGroupByRaw] = useState<GroupBy>("mv");
    const [sortBy, setSortBy] = useState<SortBy>(DEFAULT_SORT.mv);
    /** Bumped when the coupled sort flips, so the chip can replay its flash. */
    const [sortFlip, setSortFlip] = useState(0);
    const [filter, setFilter] = useState<TypeFilter>("all");
    /** Creature / non-creature split of the piles — a layout OPTION,
     *  distinct from the type filter. Owner: default OFF (persisted in
     *  localStorage in the real thing). */
    const [split, setSplitRaw] = useState(false);
    const setSplit = (on: boolean) => setSplitRaw(on);
    const [deckName, setDeckName] = useState(DEFAULT_DECK_NAME);
    const launch = useFly();

    const deck = useMemo(
        () => POOL.filter((c) => inDeck.has(c.name)),
        [inDeck]
    );
    const side = useMemo(
        () => POOL.filter((c) => !inDeck.has(c.name)),
        [inDeck]
    );
    const basicsTotal = Object.values(basics).reduce((a, b) => a + b, 0);

    const setGroupBy = (g: GroupBy) => {
        if (g === groupBy) return;
        setGroupByRaw(g);
        setSortBy(DEFAULT_SORT[g]);
        setSortFlip((n) => n + 1);
    };

    /** Move a card to the other zone; `el` is the clicked card (fly origin),
     *  `fallback` a selector to fly to when the destination is off screen. */
    const move = (
        card: ProtoCard,
        el: Element,
        fallback?: (to: Zone) => string | undefined
    ) => {
        const to: Zone = inDeck.has(card.name) ? "side" : "deck";
        launch(card.name, el, getPrintedCardImageUrl(card.id), fallback?.(to));
        setInDeck((prev) => {
            const next = new Set(prev);
            if (to === "deck") next.add(card.name);
            else next.delete(card.name);
            return next;
        });
    };

    const bumpBasic = (k: BasicKey, d: number) =>
        setBasics((prev) => ({ ...prev, [k]: Math.max(0, prev[k] + d) }));

    const pickPrinting = (k: BasicKey, id: string) =>
        setPrinting((prev) => ({ ...prev, [k]: id }));

    const passesFilter = (c: ProtoCard) =>
        filter === "all" ||
        (filter === "creatures") === c.types.includes("Creature");

    return {
        deck,
        side,
        basics,
        basicsTotal,
        printing,
        groupBy,
        setGroupBy,
        sortBy,
        setSortBy,
        sortFlip,
        filter,
        setFilter,
        passesFilter,
        split,
        setSplit,
        deckName,
        setDeckName,
        move,
        bumpBasic,
        pickPrinting,
    };
}

export type Builder = ReturnType<typeof useBuilder>;
