// Checked-in Booster Config registry (ADR 0055/0056, issue #1110). Convex
// functions run in a V8 isolate with no Node builtins (no `fs`), so this
// can't discover `data/boosters/**` at runtime — a small hand-maintained
// registry, same pattern as the CI guard's `CHECKED_IN_CONFIGS`
// (`convex/limited/__tests__/boosterConfigGuard.test.ts`). Add one line here
// for every new checked-in Booster Config (a set becoming Draftable, PRD
// #1107: "draftability doubles as a set-completion incentive").
import leaConfigJson from "../../data/boosters/lea.json";
import { computeDraftability } from "./draftable";
import type { BoosterConfig } from "./boosterTypes";

const CHECKED_IN_BOOSTER_CONFIGS: Record<string, BoosterConfig> = {
    lea: leaConfigJson as BoosterConfig,
};

/** Resolves a lowercase set code to its checked-in `BoosterConfig`, or `null`
 *  when no config is checked in for that set. Case-insensitive on the input
 *  so an admin-typed/UI-supplied code in any case still resolves. */
export function getBoosterConfig(setCode: string): BoosterConfig | null {
    return CHECKED_IN_BOOSTER_CONFIGS[setCode.toLowerCase()] ?? null;
}

export interface DraftableSetInfo {
    setCode: string;
    draftable: boolean;
    /** Count of sheet cards with no implemented `CardDefinition` — the "why
     *  isn't this set draftable" reason surfaced in the admin create-event UI
     *  (PRD #1107 story 4). Zero for a fully Draftable set. */
    missingCardCount: number;
}

/** Every checked-in Booster Config's live Draftability (ADR 0056) — computed
 *  mechanically off the card registry, never a hand-maintained "is draftable"
 *  flag, so a set becomes Draftable automatically the day its census closes. */
export function listDraftableSets(): DraftableSetInfo[] {
    return Object.entries(CHECKED_IN_BOOSTER_CONFIGS).map(
        ([setCode, config]) => {
            const result = computeDraftability(config);
            return {
                setCode,
                draftable: result.draftable,
                missingCardCount: result.missingCardIds.length,
            };
        }
    );
}

/** Whether `setCode` both has a checked-in Booster Config AND currently
 *  computes as Draftable — the gate `createLimitedEvent` enforces server-side
 *  for every `packSlots` entry (PRD #1107 story 4: "non-Draftable sets are
 *  not selectable at creation", defense-in-depth behind the UI picker). */
export function isDraftableSet(setCode: string): boolean {
    const config = getBoosterConfig(setCode);
    return config !== null && computeDraftability(config).draftable;
}
