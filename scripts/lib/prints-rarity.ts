// Rarity resolution for `scripts/prints-sync.ts` (ADR 0140, issue #4116).
//
// The model has four Rarities (`convex/cards/types.ts`); Scryfall ships two
// more ("special", "bonus" — playtest cards, Bonus Sheet crossovers). Rather
// than silently folding those into a guess per print, the mapping is a
// reviewed, committed rule in `data/prints-rarity-overrides.json`
// (`rarityFallback`), plus a `printOverrides` escape hatch for one specific
// printId — used both to correct a Scryfall miscategorization and to resolve
// an equivalence disagreement against a hand-written record.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Rarity } from "../../convex/cards/types";

const MODELLED_RARITIES: readonly Rarity[] = [
    "common",
    "uncommon",
    "rare",
    "mythic",
];

export interface RarityOverridesFile {
    rarityFallback: Record<string, Rarity>;
    printOverrides: Record<string, Rarity>;
}

const here = dirname(fileURLToPath(import.meta.url));
const OVERRIDES_PATH = join(here, "../../data/prints-rarity-overrides.json");

export function loadRarityOverrides(
    path: string = OVERRIDES_PATH
): RarityOverridesFile {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
        string,
        unknown
    >;
    return {
        rarityFallback: (raw.rarityFallback ?? {}) as Record<string, Rarity>,
        printOverrides: (raw.printOverrides ?? {}) as Record<string, Rarity>,
    };
}

function isModelledRarity(value: string): value is Rarity {
    return (MODELLED_RARITIES as readonly string[]).includes(value);
}

/**
 * Resolves one printing's Rarity. `printOverrides[printId]` wins outright;
 * otherwise a modelled Scryfall rarity passes through; otherwise
 * `rarityFallback[scryfallRarity]` applies. Throws when none of the three
 * cover an unmodelled rarity — a new Scryfall rarity value needs a reviewed
 * `rarityFallback` entry, not a silent guess.
 */
export function resolveRarity(
    printId: string,
    scryfallRarity: string,
    overrides: RarityOverridesFile
): Rarity {
    const override = overrides.printOverrides[printId];
    if (override) return override;
    if (isModelledRarity(scryfallRarity)) return scryfallRarity;
    const fallback = overrides.rarityFallback[scryfallRarity];
    if (fallback) return fallback;
    throw new Error(
        `prints-sync: printId ${printId} has unmodelled Scryfall rarity ` +
            `"${scryfallRarity}" with no rarityFallback entry in ` +
            `data/prints-rarity-overrides.json — add a reviewed rule before syncing.`
    );
}
