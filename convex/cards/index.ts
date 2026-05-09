import type { CardDefinition, CardPrint } from "./types";
import * as lea from "./sets/lea";
import * as leb from "./sets/leb";

function isCardPrint(value: unknown): value is CardPrint {
    return (
        typeof value === "object" &&
        value !== null &&
        "printId" in value &&
        "definitionId" in value &&
        "setCode" in value
    );
}

function isCardDefinition(value: unknown): value is CardDefinition {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        "name" in value &&
        "types" in value
    );
}

const setExports: Record<string, unknown>[] = [lea, leb];

const allCards: CardDefinition[] = setExports.flatMap((set) =>
    Object.values(set).filter(isCardDefinition)
);

const allPrints: CardPrint[] = setExports.flatMap((set) =>
    Object.values(set).filter(isCardPrint)
);

const definitionRegistry = new Map<string, CardDefinition>(
    allCards.map((card) => [card.id, card])
);

/** Combined lookup: every `CardDefinition.id` plus every `CardPrint.printId`
 *  resolves to the same underlying definition. Built once at module load. */
const registry = new Map<string, CardDefinition>(definitionRegistry);

for (const print of allPrints) {
    const def = definitionRegistry.get(print.definitionId);
    if (!def) {
        throw new Error(
            `CardPrint ${print.printId} references unknown definitionId ${print.definitionId}`
        );
    }
    if (registry.has(print.printId)) {
        throw new Error(`Duplicate card id: ${print.printId}`);
    }
    registry.set(print.printId, def);
}

export const getCardById = (cardId: string): CardDefinition => {
    const card = registry.get(cardId);
    if (!card) {
        throw new Error(`Card not found: ${cardId}`);
    }
    return card;
};

/** Non-throwing variant. Returns null when the id isn't in the registry — used
 *  by subsystems that operate best-effort (layer system, test fixtures). */
export const tryGetCardById = (cardId: string): CardDefinition | null =>
    registry.get(cardId) ?? null;

const nameRegistry = new Map<string, CardDefinition>(
    allCards.map((card) => [card.name.toLowerCase(), card])
);

export const getCardByName = (name: string): CardDefinition => {
    const card = nameRegistry.get(name.toLowerCase());
    if (!card) {
        throw new Error(`Card not found by name: ${name}`);
    }
    return card;
};

export const getAllCardNames = (): string[] =>
    allCards.map((card) => card.name);

/** All registered `CardDefinition`s in load order. Reprints are not included
 *  — each `CardPrint` resolves to the same definition, so callers iterating
 *  cards-as-data (deck builder index, card catalog) should consume this and
 *  use `getPrintsForCard` to enumerate printings. */
export const getAllCards = (): CardDefinition[] => allCards;

/** All known prints of a card (every Scryfall UUID that resolves to the
 *  given definition), ordered with the original print first. Used by the
 *  deck builder UI to let the player pick which edition to include. */
export const getPrintsForCard = (definitionId: string): string[] => {
    const ids = [definitionId];
    for (const print of allPrints) {
        if (print.definitionId === definitionId) ids.push(print.printId);
    }
    return ids;
};
