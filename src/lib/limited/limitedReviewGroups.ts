import { tryGetDefinition } from "@convex/cards";

/** One face in the review grid. `count` > 1 is a collapsed run of identical
 *  basics ("×N"); `caption` is a pick label ("P1p1"). */
export interface ReviewCard {
    key: string;
    cardId: string;
    cardName: string;
    count?: number;
    caption?: string;
}

export interface ReviewGroup {
    id: "creatures" | "spells" | "lands";
    label: string;
    cards: ReviewCard[];
}

interface ReviewSourceCard {
    /** The face to render: a saved deck entry's `cardId` is the opened PRINT
     *  (ADR 0140 §5, issue #5473), a Pool entry is given its opened print by
     *  the caller. */
    cardId: string;
    cardName: string;
    /** The Card Definition `cardId` prints, when `cardId` is a print — what
     *  the registry classifies the card by (the registry no longer resolves a
     *  Print ID, ADR 0140 §6). */
    definitionId?: string;
}

/** Creatures / spells / lands, in that order (issue #5392) — the split the
 *  review reads at a glance. Basic lands collapse to ONE face with a ×N count
 *  (a 40-card deck's 17 lands are otherwise a third of the page); a nonbasic
 *  land stays one face per copy. A card the registry cannot resolve lands in
 *  "spells" rather than vanishing. An empty group is dropped. */
export function groupDeckCards(
    cards: readonly ReviewSourceCard[]
): ReviewGroup[] {
    const creatures: ReviewCard[] = [];
    const spells: ReviewCard[] = [];
    const lands: ReviewCard[] = [];
    const basicByName = new Map<string, ReviewCard>();
    let landTotal = 0;

    cards.forEach((card, i) => {
        const def = tryGetDefinition(card.definitionId ?? card.cardId);
        const face: ReviewCard = {
            key: `${card.cardId}-${i}`,
            cardId: card.cardId,
            cardName: card.cardName,
        };
        if (def?.types.includes("Land")) {
            landTotal++;
            if (def.supertypes?.includes("Basic")) {
                const run = basicByName.get(card.cardName);
                if (run) {
                    run.count = (run.count ?? 1) + 1;
                } else {
                    basicByName.set(card.cardName, face);
                    lands.push(face);
                }
            } else {
                lands.push(face);
            }
        } else if (def?.types.includes("Creature")) {
            creatures.push(face);
        } else {
            spells.push(face);
        }
    });

    return (
        [
            {
                id: "creatures",
                label: `Creatures · ${creatures.length}`,
                cards: creatures,
            },
            {
                id: "spells",
                label: `Spells · ${spells.length}`,
                cards: spells,
            },
            { id: "lands", label: `Lands · ${landTotal}`, cards: lands },
        ] satisfies ReviewGroup[]
    ).filter((group) => group.cards.length > 0);
}

/** The pick sequence as faces captioned "P1p1"…: the pool array order IS the
 *  pick order (`applyPick` appends one entry per Pick). Pack size is derived,
 *  not assumed — a cube pack and a set booster differ — as the pool's length
 *  over the event's pack count. */
export function pickOrderCards(
    pool: readonly ReviewSourceCard[],
    packCount: number
): ReviewCard[] {
    const packSize = Math.max(
        1,
        Math.ceil(pool.length / Math.max(1, packCount))
    );
    return pool.map((card, i) => ({
        key: `${card.cardId}-${i}`,
        cardId: card.cardId,
        cardName: card.cardName,
        caption: `P${Math.floor(i / packSize) + 1}p${(i % packSize) + 1}`,
    }));
}
