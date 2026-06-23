// Display metadata for the card sets in the catalogue. Set *codes* are the
// source of truth (carried on every print/definition, see `getAllSetCodes`);
// this map adds the human-readable full name used by the deck builder's set
// filter. Keyrune (`ss ss-<code>`) supplies the set symbol glyph, so only the
// name needs a table here. Add one entry per new set file.
const SET_NAMES: Record<string, string> = {
    lea: "Limited Edition Alpha",
    leb: "Limited Edition Beta",
    "2ed": "Unlimited Edition",
    "3ed": "Revised Edition",
    arn: "Arabian Nights",
    atq: "Antiquities",
    leg: "Legends",
    drk: "The Dark",
    fem: "Fallen Empires",
};

/** Full set name for a code, falling back to the upper-cased code when the set
 *  has no entry yet (a newly added set file before its name is registered). */
export function setName(code: string): string {
    return SET_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

/** Keyrune CSS classes for a set's symbol glyph (`ss ss-<code>`). The font is
 *  imported globally in `index.css`. */
export function setSymbolClass(code: string): string {
    return `ss ss-${code.toLowerCase()}`;
}
