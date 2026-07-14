// Pure, seeded Booster generator (ADR 0055/0056). Given a `BoosterConfig`
// and a float stream `rng: () => number` in [0, 1) — the same shape as
// `convex/gre/rng.ts`'s `makeRng(seed)`, reused rather than re-invented so
// the draft engine, Bot Drafter, and this generator all share one seeded-PRNG
// convention — samples one pack: pick a weighted booster variant, then draw
// each variant slot's card count from its named sheet via weighted sampling
// (with replacement — a real booster can legally contain two copies of the
// same common). No I/O, no game state: `generateBooster` is a plain function
// of its two inputs, so the same `(config, rng-stream-from-seed)` pair always
// produces the same pack, and a driver (event mutation, test) owns the seed.
import type { BoosterConfig } from "./boosterTypes";

/** One drawn card, tagged with the sheet it came from. Sheets are NOT
 *  guaranteed disjoint by Scryfall id — e.g. LEA's two Alpha basic-land art
 *  variations both appear (at different weights) on more than one sheet in
 *  the real MTGJSON data — so a caller that needs "which slot was this" (a
 *  Draft UI, a rarity-aware Pick Heuristic) must read `sheet`, not infer it
 *  from the id. */
export interface BoosterCard {
    scryfallId: string;
    sheet: string;
}

/** Draws one weighted item from `entries` using `roll = rng() * totalWeight`
 *  and a cumulative walk. `totalWeight` is passed in (rather than recomputed)
 *  because callers already carry it on the config (`BoosterSheet.totalWeight`
 *  / `BoosterConfig.boostersTotalWeight`), kept in sync by the importer. */
function weightedPick<T>(
    entries: readonly (readonly [T, number])[],
    totalWeight: number,
    rng: () => number
): T {
    if (entries.length === 0) {
        throw new Error("weightedPick: no entries to draw from");
    }
    let roll = rng() * totalWeight;
    for (const [item, weight] of entries) {
        roll -= weight;
        if (roll < 0) return item;
    }
    // Floating-point rounding can leave `roll` at exactly 0 past the last
    // entry (e.g. rng() returning a value that rounds `roll` to 0 instead of
    // negative) — fall back to the last entry rather than dropping a pick.
    return entries[entries.length - 1][0];
}

/** Samples one Booster from `config` using `rng` as the sole source of
 *  randomness. Returns the pack as an ordered list of `{ scryfallId, sheet }`
 *  (order: slots as declared on the chosen variant's `contents`, each slot's
 *  cards in draw order). */
export function generateBooster(
    config: BoosterConfig,
    rng: () => number
): BoosterCard[] {
    if (config.boosters.length === 0) {
        throw new Error("generateBooster: config has no booster variants");
    }

    const variant = weightedPick(
        config.boosters.map((v) => [v, v.weight] as const),
        config.boostersTotalWeight,
        rng
    );

    const pack: BoosterCard[] = [];
    for (const [sheetName, count] of Object.entries(variant.contents)) {
        const sheet = config.sheets[sheetName];
        if (!sheet) {
            throw new Error(
                `generateBooster: booster variant references unknown sheet "${sheetName}"`
            );
        }
        const sheetEntries = Object.entries(sheet.cards) as (readonly [
            string,
            number,
        ])[];
        for (let i = 0; i < count; i++) {
            const scryfallId = weightedPick(
                sheetEntries,
                sheet.totalWeight,
                rng
            );
            pack.push({ scryfallId, sheet: sheetName });
        }
    }
    return pack;
}
