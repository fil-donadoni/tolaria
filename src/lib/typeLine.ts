/** Scryfall type-line parsing (CR 205). Shared by the Full Catalogue search
 *  pass (`useCardSearch`) and the deck-card shape resolver
 *  (`deckCardShape.ts`) — a catalogue row carries its characteristics ONLY as
 *  a printed type-line string, so every consumer that needs types/supertypes
 *  off a catalogue-only card parses it here rather than forking the split. */

const SUPER_TYPES = new Set(["Basic", "Legendary", "Snow", "World", "Ongoing"]);

/** Token is a marker characteristic (CR 110.5e), not a card type. */
const TOKEN_MARKER = "Token";

export interface ParsedTypeLine {
    types: string[];
    subtypes: string[];
    supertypes: string[];
    isToken: boolean;
}

export function parseTypeLine(typeLine: string): ParsedTypeLine {
    const trimmed = typeLine.trim();
    if (!trimmed)
        return { types: [], subtypes: [], supertypes: [], isToken: false };

    const dashIdx = trimmed.indexOf("—"); // em dash
    const beforeDash =
        dashIdx >= 0 ? trimmed.slice(0, dashIdx).trim() : trimmed;
    const afterDash = dashIdx >= 0 ? trimmed.slice(dashIdx + 1).trim() : "";

    const parts = beforeDash.split(/\s+/).filter(Boolean);
    const isToken = parts.includes(TOKEN_MARKER);
    const supertypes = parts.filter((w) => SUPER_TYPES.has(w));
    const types = parts.filter(
        (w) => w !== TOKEN_MARKER && !SUPER_TYPES.has(w)
    );
    const subtypes = afterDash ? afterDash.split(/\s+/).filter(Boolean) : [];

    return { types, subtypes, supertypes, isToken };
}
