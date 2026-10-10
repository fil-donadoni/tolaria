// PROTOTYPE — throwaway. Deck → display groups (basics collapsed with a
// count), picks → P1p1 captions.
import type { ProtoCard } from "../proto-cards";
import type { GridCard } from "./card-image-grid";

export function deckGroups(
    deck: ProtoCard[]
): { label: string; cards: GridCard[] }[] {
    const creatures = deck.filter((c) => c.types.includes("Creature"));
    const spells = deck.filter(
        (c) => !c.types.includes("Creature") && !c.types.includes("Land")
    );
    const lands = deck.filter((c) => c.types.includes("Land"));
    const landCounts = new Map<string, { card: ProtoCard; n: number }>();
    for (const l of lands) {
        const e = landCounts.get(l.name);
        if (e) e.n++;
        else landCounts.set(l.name, { card: l, n: 1 });
    }
    const one = (cs: ProtoCard[]) =>
        cs.map((card, i) => ({ card, key: `${card.id}-${i}` }));
    return [
        { label: `Creatures · ${creatures.length}`, cards: one(creatures) },
        { label: `Spells · ${spells.length}`, cards: one(spells) },
        {
            label: `Lands · ${lands.length}`,
            cards: [...landCounts.values()].map(({ card, n }) => ({
                card,
                key: card.id,
                count: n,
            })),
        },
    ].filter((g) => g.cards.length > 0);
}

export function pickCards(picks: ProtoCard[]): GridCard[] {
    return picks.map((card, i) => ({
        card,
        key: `${card.id}-${i}`,
        caption: `P${Math.floor(i / 15) + 1}p${(i % 15) + 1}`,
    }));
}
