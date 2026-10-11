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
import invConfigJson from "../../data/boosters/inv.json";
import plsConfigJson from "../../data/boosters/pls.json";
import apcConfigJson from "../../data/boosters/apc.json";
import { computeDraftability, dropUnimplementedCards } from "./draftable";
import {
    CUBE_DISPLAY_NAME,
    CUBE_SOURCE_KEY,
    buildCubePool,
    cubePoolSize,
    isCubeSource,
} from "./cube";
import { getPickRating } from "./pickRatings";
import { DRAFT_BOOSTER_COUNT } from "./eventLogic";
import { resolveCardName, tryGetDefinition } from "../cards";
import { setName } from "../cards/setMeta";
import type { BoosterConfig } from "./boosterTypes";
import type { LimitedEventType } from "./eventTypes";

const CHECKED_IN_BOOSTER_CONFIGS: Record<string, BoosterConfig> = {
    lea: leaConfigJson as BoosterConfig,
    ice: iceConfigJson as BoosterConfig,
    drk: drkConfigJson as BoosterConfig,
    inv: invConfigJson as BoosterConfig,
    pls: plsConfigJson as BoosterConfig,
    apc: apcConfigJson as BoosterConfig,
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

/** The Card ID a checked-in sheet's Print ID is a printing of
 *  (`BoosterConfig.printCardIds`), or `undefined` for any other id. The
 *  registry cannot resolve a Print ID (ADR 0140 §5); this is how the client's
 *  Draft Lab, which has no `cardPrints` rows, still recognises a sheet's
 *  reprint cards. */
export function getSheetPrintCardId(printId: string): string | undefined {
    for (const config of Object.values(CHECKED_IN_BOOSTER_CONFIGS)) {
        const cardId = config.printCardIds?.[printId];
        if (cardId !== undefined) return cardId;
    }
    return undefined;
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

// --- Pack Source catalogue (PRD #5383, issue #5385) -------------------------
// What a Limited Event's packs are generated FROM, picked whole (GLOSSARY
// "Pack Source"): one Draftable Set's boosters, a fixed block sequence (one set
// per pack, INV → PLS → APC), or the Vintage Cube. A mixed sequence is a new
// entry here, never assembled pack by pack at setup. The array order IS the
// display order — Vintage Cube first.

/** One hand-written catalogue entry. `packs` lists the source of each Draft
 *  booster, in pack order: three copies of one set for a single-set source,
 *  the block's sets for a sequence. `featureCardId` is the hand-picked
 *  Feature Card (a `CardDefinition.id`); absent → `resolveFeatureCardId`
 *  falls back to the source's highest-Pick-Rating rare. */
export interface PackSourceEntry {
    key: string;
    name: string;
    description: string;
    packs: readonly string[];
    featureCardId?: string;
}

/** Three boosters of one set (or of the cube) — the classic Draft shape
 *  (`DRAFT_BOOSTER_COUNT`, PRD #1241 story 7). */
function threeOf(source: string): readonly string[] {
    return Array.from({ length: DRAFT_BOOSTER_COUNT }, () => source);
}

/** The catalogue, in display order. An entry whose `packs` set has no
 *  checked-in Booster Config would never be draftable (`listPackSources`), so
 *  an entry ahead of its config is dead weight. */
const PACK_SOURCES: readonly PackSourceEntry[] = [
    {
        key: CUBE_SOURCE_KEY,
        name: CUBE_DISPLAY_NAME,
        description:
            "The most powerful cards in Magic's history, one copy each — Power Nine included.",
        packs: threeOf(CUBE_SOURCE_KEY),
        // Black Lotus
        featureCardId: "b0faa7f2-b547-42c4-a810-839da50dadfe",
    },
    {
        key: "lea",
        name: setName("lea"),
        description:
            "Where it all began: the 1993 core set, Moxen and Lotus in the rare slot.",
        packs: threeOf("lea"),
        // Mox Sapphire
        featureCardId: "82da0972-b17b-4600-9efd-e9430a0db04b",
    },
    {
        key: "ice",
        name: setName("ice"),
        description:
            "Snow, cumulative upkeep and the first standalone expansion's frozen wastes.",
        packs: threeOf("ice"),
        // Necropotence
        featureCardId: "54d7a0c1-efb4-4a8d-ad92-a96d43835052",
    },
    {
        key: "drk",
        name: setName("drk"),
        description:
            "A small, grim expansion of curses, swamps and forbidden knowledge.",
        packs: threeOf("drk"),
        // Maze of Ith
        featureCardId: "42dcceee-2a47-4eaa-a6a3-2931b3d50244",
    },
    {
        key: "inv",
        name: setName("inv"),
        description:
            "Multicolour gold cards and kicker: the 2000 expansion that started the Invasion block.",
        packs: threeOf("inv"),
        // Fact or Fiction
        featureCardId: "7fd4d018-dcf3-4439-8445-02d66e44f7d3",
    },
    {
        key: "invasion-block",
        name: "Invasion Block",
        description:
            "Invasion, Planeshift and Apocalypse, one set per pack: the whole block in a single draft.",
        packs: ["inv", "pls", "apc"],
        // Dromar, the Banisher
        featureCardId: "cfcc3c72-fff5-454c-814c-eb952fd23ba9",
    },
];

/** The catalogue entry for `key` (case-insensitive), or `null` for a key the
 *  catalogue does not hold. */
export function getPackSource(key: string): PackSourceEntry | null {
    const wanted = key.toLowerCase();
    return PACK_SOURCES.find((source) => source.key === wanted) ?? null;
}

/** A source's distinct sets, in first-pack order. */
function distinctPacks(source: PackSourceEntry): string[] {
    return [...new Set(source.packs)];
}

/** Whether `source` can generate packs for an event of `type`. The cube is
 *  Draft-only (ADR 0062 §4: `generateSealedPools` has no cube path). */
export function isPackSourceUsableFor(
    source: PackSourceEntry,
    type: LimitedEventType
): boolean {
    return type === "draft" || !source.packs.some(isCubeSource);
}

/** The `packSlots` an event of `type` stores for `source` — the per-pack sets
 *  `createLimitedEvent` validated before Pack Sources existed. Draft: one
 *  entry per booster, in pack order (`applyPick` ends the draft after
 *  `packSlots.length` rounds). Sealed: each distinct set once, cycled
 *  `sealedBoosterCount` times by `generateSealedPools`. */
export function resolvePackSlots(
    source: PackSourceEntry,
    type: LimitedEventType
): string[] {
    return type === "draft" ? [...source.packs] : distinctPacks(source);
}

/** Card ids that are rares of `set`: its Booster Config's `rare` sheet
 *  (the set-local rarity — a reprint's home-set rarity can differ), each
 *  Print ID mapped to its Card ID; the cube has no sheets, so its pool is
 *  filtered on the definition's rarity. Unimplemented cards are skipped —
 *  a Feature Card must render. */
function rareCardIds(set: string): string[] {
    if (isCubeSource(set)) {
        return buildCubePool().filter(
            (cardId) => tryGetDefinition(cardId)?.rarity === "rare"
        );
    }
    const sheet = getBoosterConfig(set)?.sheets.rare;
    if (!sheet) return [];
    return Object.keys(sheet.cards)
        .map((printId) => getSheetPrintCardId(printId) ?? printId)
        .filter((cardId) => resolveCardName(cardId) !== null);
}

/** Pick Rating of `cardId` within scope `set`, `null` when unrated. */
export type PackSourceRatingLookup = (
    set: string,
    cardId: string
) => number | null;

/** The Feature Card of `source` (GLOSSARY "Feature Card"): the hand-picked
 *  one, else the rare with the highest Pick Rating across the source's sets.
 *  An unrated rare ranks below every rated one; ties break on the lowest
 *  card id so the pick is stable. `null` only when the source has no
 *  implemented rare at all. */
export function resolveFeatureCardId(
    source: PackSourceEntry,
    getRating: PackSourceRatingLookup = getPickRating
): string | null {
    if (source.featureCardId !== undefined) return source.featureCardId;
    let best: { cardId: string; rating: number } | null = null;
    for (const set of distinctPacks(source)) {
        for (const cardId of rareCardIds(set)) {
            const rating = getRating(set, cardId) ?? -Infinity;
            if (
                best === null ||
                rating > best.rating ||
                (rating === best.rating && cardId < best.cardId)
            ) {
                best = { cardId, rating };
            }
        }
    }
    return best?.cardId ?? null;
}

/** One catalogue entry as the create-event picker reads it: identity and
 *  presentation, plus the live Draftability of each distinct set it draws
 *  from (the Incompleteness Notice / cube note source). */
export interface PackSourceInfo {
    key: string;
    name: string;
    description: string;
    featureCardId: string | null;
    /** The cube is Draft-only (ADR 0062 §4). */
    draftOnly: boolean;
    /** Every distinct set is currently Draftable (ADR 0059). */
    draftable: boolean;
    sets: DraftableSetInfo[];
}

/** The catalogue in display order, each entry annotated with its sets' live
 *  Draftability (`listDraftableSets`) and its resolved Feature Card. */
export function listPackSources(
    catalogue: readonly PackSourceEntry[] = PACK_SOURCES
): PackSourceInfo[] {
    const draftability = new Map(
        listDraftableSets().map((info) => [info.setCode, info])
    );
    return catalogue.map((source) => {
        const sets = distinctPacks(source).flatMap((set) => {
            const info = draftability.get(set);
            return info ? [info] : [];
        });
        return {
            key: source.key,
            name: source.name,
            description: source.description,
            featureCardId: resolveFeatureCardId(source),
            draftOnly: !isPackSourceUsableFor(source, "sealed"),
            draftable:
                sets.length === distinctPacks(source).length &&
                sets.every((info) => info.draftable),
            sets,
        };
    });
}
