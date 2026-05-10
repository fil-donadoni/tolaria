import type { Doc, Id } from "@convex/_generated/dataModel";
import type { DeckCard, DeckPreset } from "@convex/deckPresets";

export interface LobbyDeckBase {
    presetId: string;
    name: string;
    format: string;
    description?: string;
    colors: string[];
    cards: DeckCard[];
}

export interface PresetLobbyDeck extends LobbyDeckBase {
    kind: "preset";
}

export interface UserLobbyDeck extends LobbyDeckBase {
    kind: "user";
    userDeckId: Id<"userDecks">;
}

export type LobbyDeck = PresetLobbyDeck | UserLobbyDeck;

export function toPresetLobbyDeck(d: DeckPreset): PresetLobbyDeck {
    return {
        kind: "preset",
        presetId: d.presetId,
        name: d.name,
        format: d.format,
        description: d.description,
        colors: d.colors,
        cards: d.cards,
    };
}

export function toUserLobbyDeck(d: Doc<"userDecks">): UserLobbyDeck {
    return {
        kind: "user",
        userDeckId: d._id,
        presetId: d._id as string,
        name: d.name,
        format: d.format,
        description: d.description,
        colors: d.colors,
        cards: d.cards,
    };
}

export function deckPayload(d: LobbyDeck): {
    id: string;
    name: string;
    format: string;
    cards: DeckCard[];
} {
    return {
        id: d.presetId,
        name: d.name,
        format: d.format,
        cards: d.cards,
    };
}
