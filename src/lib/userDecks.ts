/** Next sequential auto-name for a brand new deck — "Deck 1", "Deck 2", …
 *  Picks max(N) + 1 across decks already named with the "Deck N" pattern,
 *  ignoring renamed decks. */
export function nextDeckName(decks: { name: string }[]): string {
    let max = 0;
    for (const d of decks) {
        const m = d.name.match(/^Deck (\d+)$/);
        if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > max) max = n;
        }
    }
    return `Deck ${max + 1}`;
}
