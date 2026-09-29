// Shared fixtures for the Oracle compiler tests.
//
// Not a `describe` file — vitest's include glob is `*.test.ts`, so this is a
// plain module the test files import.

import { readTypeLine } from "../typeLine";
import { SELF_MARKER } from "../normalize";
import type { OracleCard, ParseContext } from "../types";

export function oracleCard(overrides: Partial<OracleCard> = {}): OracleCard {
    return {
        oracleId: "00000000-0000-0000-0000-000000000000",
        name: "Test Card",
        manaCost: "{1}{G}",
        typeLine: "Creature — Bear",
        oracleText: "",
        power: "2",
        toughness: "2",
        layout: "normal",
        ...overrides,
    };
}

export function parseContext(card: OracleCard = oracleCard()): ParseContext {
    const typeLine = readTypeLine(card.typeLine);
    if (!typeLine.ok)
        throw new Error(`fixture type line does not parse: ${card.typeLine}`);
    return { card, typeLine: typeLine.parsed, selfMarker: SELF_MARKER };
}
