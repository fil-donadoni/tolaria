// Checked-in Booster Config registry (ADR 0055/0056/0059, issue #1110). Convex
// functions run in a V8 isolate with no Node builtins (no `fs`), so this
// can't discover `data/boosters/**` at runtime — a small hand-maintained
// registry, same pattern as the CI guard's `CHECKED_IN_CONFIGS`
// (`convex/limited/__tests__/boosterConfigGuard.test.ts`). Add one line here
// for every new checked-in Booster Config (a set becoming Draftable, PRD
// #1107: "draftability doubles as a set-completion incentive").
import leaConfigJson from "../../data/boosters/lea.json";
import iceConfigJson from "../../data/boosters/ice.json";
import drkConfigJson from "../../data/boosters/drk.json";
import { computeDraftability, dropUnimplementedCards } from "./draftable";
import { CUBE_SOURCE_KEY, cubePoolSize, isCubeSource } from "./cube";
import type { BoosterConfig } from "./boosterTypes";

const CHECKED_IN_BOOSTER_CONFIGS: Record<string, BoosterConfig> = {
    lea: leaConfigJson as BoosterConfig,
    ice: iceConfigJson as BoosterConfig,
    drk: drkConfigJson as BoosterConfig,
};

/** Resolves a lowercase set code to its checked-in `BoosterConfig`, or `null`
 *  when no config is checked in for that set. Case-insensitive on the input
 *  so an admin-typed/UI-supplied code in any case still resolves. This is
 *  the RAW config (nothing dropped beyond the ADR-0010 exclusions already
 *  stripped at import time) — used by the Draftability gate, which needs to
 *  see every sheet card to compute coverage. Pack generation must NOT read
 *  this directly; see `getRuntimeBoosterConfig` below. */
export function getBoosterConfig(setCode: string): BoosterConfig | null {
    return CHECKED_IN_BOOSTER_CONFIGS[setCode.toLowerCase()] ?? null;
}

/** Per-sheet Draftability verdict for one set (ADR 0059) — the reason a
 *  sheet is or isn't why the set overall is Draftable. */
export interface DraftableSheetInfo {
    sheetName: string;
    /** Fraction of the sheet's cards that resolve to an implemented
     *  `CardDefinition`, in [0, 1]. */
    coverage: number;
    /** Whether this sheet alone clears the ≥80% floor. */
    passes: boolean;
}

export interface DraftableSetInfo {
    setCode: string;
    draftable: boolean;
    /** Count of sheet cards with no implemented `CardDefinition`, summed
     *  across every sheet (deduplicated by id) — the drop count: how many
     *  ids `getRuntimeBoosterConfig` removes from this set's print run.
     *  Zero for a fully (100%) implemented set. */
    missingCardCount: number;
    /** Per-sheet verdict (PRD #1242 AC5) — surfaces WHICH sheet(s), if any,
     *  are below the ≥80% floor, rather than just the set-level boolean. */
    sheets: DraftableSheetInfo[];
    /** Vintage Cube pool source (ADR 0062): true only for the cube entry.
     *  A cube is a curated POOL, not a set to complete — the UI shows
     *  `availableCardCount` ("Cube: N cards available") instead of the
     *  Incompleteness "N missing" disable. Absent/false for real sets. */
    isCube?: boolean;
    /** Cube only (ADR 0062): the implemented pool size N — how many cards the
     *  cube can currently deal from. Absent for real sets. */
    availableCardCount?: number;
}

/** Every checked-in Booster Config's live Draftability (ADR 0059) — computed
 *  mechanically off the card registry, never a hand-maintained "is draftable"
 *  flag, so a set becomes Draftable automatically the day its sheets cross
 *  the per-sheet ≥80% floor. */
export function listDraftableSets(): DraftableSetInfo[] {
    const sets: DraftableSetInfo[] = Object.entries(
        CHECKED_IN_BOOSTER_CONFIGS
    ).map(([setCode, config]) => {
        const result = computeDraftability(config);
        return {
            setCode,
            draftable: result.draftable,
            missingCardCount: result.missingCardIds.length,
            sheets: result.sheets.map((s) => ({
                sheetName: s.sheetName,
                coverage: s.coverage,
                passes: s.passes,
            })),
        };
    });
    // Append the Vintage Cube pool source (ADR 0062) — ALWAYS draftable (never
    // the ≥80% per-sheet gate: a cube is curated, not a set to complete),
    // surfaced with its implemented pool size N, not a missing-card count.
    sets.push({
        setCode: CUBE_SOURCE_KEY,
        draftable: true,
        missingCardCount: 0,
        sheets: [],
        isCube: true,
        availableCardCount: cubePoolSize(),
    });
    return sets;
}

/** Whether `setCode` both has a checked-in Booster Config AND currently
 *  computes as Draftable under the per-sheet ≥80% gate (ADR 0059) — the gate
 *  `createLimitedEvent` enforces server-side for every `packSlots` entry
 *  (PRD #1107 story 4: "non-Draftable sets are not selectable at creation",
 *  defense-in-depth behind the UI picker). */
export function isDraftableSet(setCode: string): boolean {
    // The Vintage Cube pool source (ADR 0062) is ALWAYS draftable — it is a
    // curated pool, not a set to complete, so it deliberately bypasses the
    // ≥80% per-sheet gate (and has no checked-in Booster Config to gate on).
    if (isCubeSource(setCode)) return true;
    const config = getBoosterConfig(setCode);
    return config !== null && computeDraftability(config).draftable;
}

/** The config pack generation MUST use (ADR 0059): `getBoosterConfig`'s raw
 *  sheets with every currently-unimplemented card dropped and weights
 *  renormalized, checked against the LIVE registry at call time — never
 *  baked into the checked-in JSON, so a card landing mid-event's lifetime
 *  (or, more realistically, between two separate events) is picked up
 *  automatically with no re-import step. Every pack-generation call site
 *  (`startDraft`, `runBotAutoPicks`, `generateSealedPools`, `applyPick` — all
 *  wired in `convex/limitedEvents.ts`) uses this in place of the raw
 *  `getBoosterConfig`. Returns `null` under the same condition
 *  `getBoosterConfig` does (no checked-in config for `setCode`) — it does
 *  NOT additionally gate on Draftability; that's `isDraftableSet`'s job at
 *  event-creation time, not pack-generation time. */
export function getRuntimeBoosterConfig(setCode: string): BoosterConfig | null {
    const config = getBoosterConfig(setCode);
    if (!config) return null;
    return dropUnimplementedCards(config).config;
}
