/**
 * Station STRIATIONS — the line groups a station card is split into before any
 * line is routed (CR 721.2, issue #10528).
 *
 * CR 721.2: "Any abilities printed within the same text box striation as a
 * station symbol are part of its static ability." Oracle text prints a symbol
 * as `N+ | ` at the head of its striation's first line, and the striation runs
 * to the next symbol: a line with no symbol under one is part of it (Scryfall's
 * "8+ | Flying\nOther artifacts you control have hexproof and indestructible.").
 * Lines above the first symbol are treated normally (CR 721.4).
 *
 * Structural, like `classSections.ts`. The station KEYWORD line is structural
 * too: it is read here, not routed, because the ability it names is what
 * `expandStationThresholds` adds for every station card — and its reminder is
 * the one place Oracle text says which striation holds the P/T box ("It's an
 * artifact creature at 8+."). A card is a station card only when it prints the
 * keyword: the same `N+ | ` spelling heads a d20 result line (CR 706.2,
 * "15+ | Return those cards …"), which this reader never sees.
 */

/** CR 702.184a — the keyword line, bare or with its reminder. */
const STATION_KEYWORD_LINE = /^Station(?: \((.*)\))?$/;

/** The reminder's statement of the P/T box's striation (CR 721.2b). */
const CREATURE_AT = /It's an artifact creature at (\d+)\+\.$/;

/** CR 721.2 — a station symbol at the head of its striation's first line. */
const STATION_SYMBOL_LINE = /^(\d+)\+ \| (.+)$/;

/** One station symbol with the lines printed in its striation. */
export interface StationSection {
    /** The symbol's own printed line, which a refusal names. */
    readonly symbolLine: string;
    /** N in `{N+}`. */
    readonly charge: number;
    readonly lines: readonly string[];
}

export interface StationSections {
    /** CR 721.4 — every line above the first symbol except the keyword. */
    readonly top: readonly string[];
    readonly sections: readonly StationSection[];
    /** The keyword's printed line. */
    readonly keywordLine: string;
    /** CR 721.2b — the charge the reminder names for the P/T box, when it
     *  names one. */
    readonly creatureAt?: number;
}

/** Split a station card's text at its symbols, or `null` when the card prints
 *  no station keyword (it is not a station card). */
export function readStationSections(
    oracleText: string
): StationSections | null {
    const lines = oracleText.split("\n").map((l) => l.trim());
    const keywordIndex = lines.findIndex((l) => STATION_KEYWORD_LINE.test(l));
    if (keywordIndex < 0) return null;
    const keywordLine = lines[keywordIndex]!;
    const reminder = STATION_KEYWORD_LINE.exec(keywordLine)![1];
    const creatureAt =
        reminder === undefined ? undefined : CREATURE_AT.exec(reminder)?.[1];
    const top: string[] = [];
    const sections: (StationSection & { lines: string[] })[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (i === keywordIndex) continue;
        const line = lines[i]!;
        const symbol = STATION_SYMBOL_LINE.exec(line);
        if (symbol === null) {
            (sections[sections.length - 1]?.lines ?? top).push(line);
            continue;
        }
        sections.push({
            symbolLine: line,
            charge: Number(symbol[1]),
            lines: [symbol[2]!],
        });
    }
    return {
        top,
        sections,
        keywordLine,
        ...(creatureAt !== undefined ? { creatureAt: Number(creatureAt) } : {}),
    };
}
