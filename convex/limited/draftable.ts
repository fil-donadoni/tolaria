// Draftable-Set gate (ADR 0056): a set is Draftable iff every card in its
// Booster Config sheets resolves to an implemented `CardDefinition` — checked
// mechanically against the single registry seam (`tryGetDefinition`), never a
// hand-maintained whitelist. ADR-excluded cards (Chaos Orb, the ante trio)
// never reach this check: the importer already stripped them from the sheets
// (`mtgjsonImport.ts` + `adrExclusions.ts`), so they read as "absent from the
// print run", not "missing implementation".
import { tryGetDefinition } from "../cards";
import type { BoosterConfig } from "./boosterTypes";

export interface DraftabilityResult {
    draftable: boolean;
    /** Scryfall ids present in the config's sheets with no implemented
     *  `CardDefinition` — the reason a non-Draftable set isn't one, surfaced
     *  for the admin UI (PRD #1107, "why isn't this set draftable"). Sorted
     *  for a stable/diffable result; empty when `draftable` is true. */
    missingCardIds: string[];
}

/** Computes Draftability for `config` by checking every unique Scryfall id
 *  across every sheet against the card registry. Pure — no I/O, no game
 *  state — so it can run over an in-memory config built straight from
 *  `buildBoosterConfig` (as the "partial set" test does) as well as over a
 *  checked-in `data/boosters/*.json` config. */
export function computeDraftability(config: BoosterConfig): DraftabilityResult {
    const missing = new Set<string>();
    for (const sheet of Object.values(config.sheets)) {
        for (const scryfallId of Object.keys(sheet.cards)) {
            if (!tryGetDefinition(scryfallId)) missing.add(scryfallId);
        }
    }
    const missingCardIds = [...missing].sort();
    return { draftable: missingCardIds.length === 0, missingCardIds };
}
