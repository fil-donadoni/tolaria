// Auto-Build tests (PRD #1107 stories 24-25, ADR 0054/0055, issue #1115):
// deterministic unit tests for 2-color selection, curve-aware spell fill, and
// "no foreign cards" against the REAL LEA card registry + Booster Config —
// mirrors `botDrafter.test.ts`'s discipline (pure functions, no convex-test
// harness needed). A separate property test below asserts EVERY bot seat's
// Auto-Built deck validates as `limited`-legal against its own Pool, over
// many seeded Sealed AND Draft events.
import { makeResolveBasicLand } from "../resolveBasicLand";
import { describe, it, expect } from "vitest";
import {
    getCardByName,
    resolveDeckCardMeta,
    tryGetDefinition,
} from "../../cards";
import { getCardColorIdentity, getPipCountsFromCost } from "../../cards/colors";
import type { Color } from "../../cards/types";
import { getDefinitionProducibleColors, manaValue } from "../../gre/constants";
import { makeRng } from "../../gre/rng";
import { validateDeck, type Pool, type ResolvePool } from "../../formats";
import {
    MAX_DECK_COLORS,
    autoBuildDeck,
    chooseDeckColors,
    computeBotAutoBuiltDeck,
    isEventPoolFinal,
    type AutoBuildCardMeta,
    type AutoBuildEventContext,
    type GetAutoBuildCardMeta,
    type ResolveBasicLand,
} from "../autoBuild";
import type { CardProfile, GetCardProfile } from "../cardProfilesCore";
import { archetypeScopeShareOf, choosePlanArchetype } from "../planArchetype";
import {
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
} from "../draftEngine";
import {
    candidateQuality,
    capabilityFitTerm,
    chooseBotPick,
    heuristicAsRating,
    poolProfiles,
    type GetCardEvalMeta,
} from "../botDrafter";
import {
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../eventLogic";
import { poolFromLimitedPoolCards } from "../poolResolution";
import { getBoosterConfig } from "../registry";
import type { LimitedPoolCard } from "../eventTypes";

// --- Shared registry-backed resolvers (mirrors convex/limitedEvents.ts) ---

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

const getCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
    };
};

const botChoosePick: ChooseBotPick = (seat, pack, packsSeen) =>
    chooseBotPick(pack, seat.pool ?? [], getCardEvalMeta, { packsSeen });

const getAutoBuildCardMeta: GetAutoBuildCardMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
        isLand: def.types.includes("Land"),
        isBasicLand:
            def.types.includes("Land") &&
            (def.supertypes?.includes("Basic") ?? false),
    };
};

function resolveBasicLandFor(setCode: string): ResolveBasicLand {
    // No `cardPrints` rows in a unit test: the LEA basics resolve to the
    // definition's own printing, the same answer the table-less path gives.
    return makeResolveBasicLand(setCode, new Map());
}
const resolveBasicLand = resolveBasicLandFor("lea");

/** Builds a real `AutoBuildCardMeta` from a LEA card name (mirrors
 *  `botDrafter.test.ts`'s `metaOf`). */
function metaOf(name: string): AutoBuildCardMeta {
    const def = getCardByName(name);
    return {
        cardId: def.id,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: def.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
        isLand: def.types.includes("Land"),
        isBasicLand:
            def.types.includes("Land") &&
            (def.supertypes?.includes("Basic") ?? false),
    };
}

function poolCard(
    scryfallId: string,
    meta: AutoBuildCardMeta
): LimitedPoolCard {
    return { scryfallId, cardId: meta.cardId, cardName: scryfallId };
}

function metaLookup(
    entries: Record<string, AutoBuildCardMeta>
): GetAutoBuildCardMeta {
    return (scryfallId) => entries[scryfallId] ?? null;
}

// --- chooseDeckColors: pip-weighted commitment + derived count (#1615) -----
//
// The colour terms are `botDrafter.ts`'s own (`colourAffinityWeights`,
// `pipDemandByColor`, `sourceCountsByColor`) — these tests assert Auto-Build
// READS them, in the directions ADR 0073 specifies, not the weights
// themselves (which `botDrafter.bot.test.ts` owns).

/** A synthetic SPELL meta: real card quality (so `cardValueById` behaves), an
 *  overridden pip cost — the signal `chooseDeckColors` actually ranks by. */
function spellWithPips(
    base: AutoBuildCardMeta,
    pips: Partial<Record<Color, number>>
): AutoBuildCardMeta {
    return {
        ...base,
        pips,
        colors: Object.keys(pips) as Color[],
        producedColors: [],
        isLand: false,
        isBasicLand: false,
    };
}

/** A synthetic non-basic mana SOURCE (a dual land): produces `colors`, has no
 *  pips of its own, and is explicitly NOT a basic — the distinction the
 *  three-colour test turns on. */
function sourceProducing(
    base: AutoBuildCardMeta,
    producedColors: Color[]
): AutoBuildCardMeta {
    return {
        ...base,
        pips: {},
        colors: producedColors,
        producedColors,
        manaValue: 0,
        isLand: true,
        isBasicLand: false,
    };
}

describe("chooseDeckColors — pip-weighted Colour Commitment (issue #1615)", () => {
    const anchor = metaOf("Lightning Bolt");

    it("ranks by PIPS, not by card count: one {U}{U}{U} outcommits two single-pip Red cards", () => {
        // The defect this replaces summed `cardValueById × rarity` per card,
        // so a colour's rank was a CARD COUNT. Every meta here shares one
        // `cardId` (hence one quality), so quality cannot explain the answer —
        // only the pip weighting can. A count-based ranking puts Red first
        // (two cards vs one); a pip-weighted one puts Blue first (3 pips vs 2).
        const blue = spellWithPips(anchor, { U: 3 });
        const red = spellWithPips(anchor, { R: 1 });
        const entries = { u1: blue, r1: red, r2: red };
        const pool = [
            poolCard("u1", blue),
            poolCard("r1", red),
            poolCard("r2", red),
        ];
        expect(chooseDeckColors(pool, metaLookup(entries))).toEqual(["U", "R"]);
    });

    it("a mana SOURCE follows commitment rather than creating it: two duals lose to one real pip", () => {
        // ADR 0073's load-bearing asymmetry — a strong land taken early must
        // not marry the seat to a colour. Two Green-producing sources
        // (2 × COLOUR_COMMIT_SOURCE_UNIT_WEIGHT = 0.8 units) still rank below
        // one single-pip Red spell (1.0 unit).
        const red = spellWithPips(anchor, { R: 1 });
        const greenSource = sourceProducing(anchor, ["G"]);
        const entries = { r1: red, g1: greenSource, g2: greenSource };
        const pool = [
            poolCard("r1", red),
            poolCard("g1", greenSource),
            poolCard("g2", greenSource),
        ];
        expect(chooseDeckColors(pool, metaLookup(entries))[0]).toBe("R");
    });

    it("ties break by WUBRG order, deterministically", () => {
        const red = spellWithPips(anchor, { R: 1 });
        const green = spellWithPips(anchor, { G: 1 });
        const entries = { r1: red, g1: green };
        const pool = [poolCard("r1", red), poolCard("g1", green)];
        // WUBRG order: Red (position 4) precedes Green (position 5).
        expect(chooseDeckColors(pool, metaLookup(entries))).toEqual(["R", "G"]);
    });

    it("falls back to W/U (first two WUBRG colors) for a pool with no colored cards", () => {
        const plains = metaOf("Plains");
        const entries = { p1: plains };
        const pool: LimitedPoolCard[] = [poolCard("p1", plains)];
        expect(chooseDeckColors(pool, metaLookup(entries))).toEqual(["W", "U"]);
    });
});

// --- Derived colour COUNT (issue #1615) ------------------------------------

/** One Pool shape, built twice: identical SPELLS (heavy W, heavy U, light B),
 *  differing only in whether the Pool also holds Black fixing. The pair is the
 *  whole acceptance criterion — "a pool with a three-colour mana base can
 *  build three colours; one without cannot" — as a direction, not a number. */
function threeColorFixture(withFixing: boolean) {
    const anchor = metaOf("Lightning Bolt");
    const white = spellWithPips(anchor, { W: 1 });
    const blue = spellWithPips(anchor, { U: 1 });
    const black = spellWithPips(anchor, { B: 1 });
    // Scrubland: a real LEA non-basic dual, producing {W} and {B}.
    const dual = sourceProducing(metaOf("Scrubland"), ["W", "B"]);
    const entries: Record<string, AutoBuildCardMeta> = {};
    const pool: LimitedPoolCard[] = [];
    const add = (key: string, meta: AutoBuildCardMeta) => {
        entries[key] = meta;
        pool.push(poolCard(key, meta));
    };
    for (let i = 0; i < 6; i++) add(`w${i}`, white);
    for (let i = 0; i < 6; i++) add(`u${i}`, blue);
    for (let i = 0; i < 2; i++) add(`b${i}`, black);
    if (withFixing) for (let i = 0; i < 3; i++) add(`d${i}`, dual);
    return { pool, getMeta: metaLookup(entries) };
}

describe("derived colour count (issue #1615)", () => {
    it("commits to a THIRD colour when the Pool's own non-basic sources cover it", () => {
        const { pool, getMeta } = threeColorFixture(true);
        const colors = chooseDeckColors(pool, getMeta);
        expect(colors).toHaveLength(3);
        expect(new Set(colors)).toEqual(new Set(["W", "U", "B"]));
        expect(colors.length).toBeLessThanOrEqual(MAX_DECK_COLORS);
    });

    it("stays on TWO colours when the same spells come with no fixing for the third", () => {
        // Identical spells, zero duals — the Black spells are still there and
        // still rank third, but nothing in the Pool produces {B}, so the
        // `max(0, need − sources)` deficit is positive and the splash is
        // refused. Basics can't rescue it: a basic is a land slot taken from
        // the top two colours, which is exactly why `isBasicLand` metas are
        // excluded from the source count.
        const { pool, getMeta } = threeColorFixture(false);
        expect(chooseDeckColors(pool, getMeta)).toEqual(["W", "U"]);
    });

    it("basics in the Pool are NOT fixing — they never unlock a third colour", () => {
        // Same shape as the positive case, but the three sources are BASIC
        // Swamps instead of Scrublands. A basic is free to the builder, so
        // counting it as evidence would make every Pool three-colour.
        const anchor = metaOf("Lightning Bolt");
        const white = spellWithPips(anchor, { W: 1 });
        const blue = spellWithPips(anchor, { U: 1 });
        const black = spellWithPips(anchor, { B: 1 });
        const swamp: AutoBuildCardMeta = { ...metaOf("Swamp") };
        expect(swamp.isBasicLand).toBe(true);
        expect(swamp.producedColors).toContain("B");
        const entries: Record<string, AutoBuildCardMeta> = {};
        const pool: LimitedPoolCard[] = [];
        const add = (key: string, meta: AutoBuildCardMeta) => {
            entries[key] = meta;
            pool.push(poolCard(key, meta));
        };
        for (let i = 0; i < 6; i++) add(`w${i}`, white);
        for (let i = 0; i < 6; i++) add(`u${i}`, blue);
        for (let i = 0; i < 2; i++) add(`b${i}`, black);
        for (let i = 0; i < 3; i++) add(`s${i}`, swamp);
        expect(chooseDeckColors(pool, metaLookup(entries))).toEqual(["W", "U"]);
    });

    it("a colour the Pool has SOURCES but no SPELLS for is fixing, not a third colour", () => {
        const anchor = metaOf("Lightning Bolt");
        const white = spellWithPips(anchor, { W: 1 });
        const blue = spellWithPips(anchor, { U: 1 });
        const dual = sourceProducing(metaOf("Scrubland"), ["W", "B"]);
        const entries: Record<string, AutoBuildCardMeta> = {};
        const pool: LimitedPoolCard[] = [];
        const add = (key: string, meta: AutoBuildCardMeta) => {
            entries[key] = meta;
            pool.push(poolCard(key, meta));
        };
        for (let i = 0; i < 6; i++) add(`w${i}`, white);
        for (let i = 0; i < 6; i++) add(`u${i}`, blue);
        for (let i = 0; i < 4; i++) add(`d${i}`, dual);
        expect(chooseDeckColors(pool, metaLookup(entries))).toEqual(["W", "U"]);
    });

    it("the third colour's own fixing is MAINDECKED, not left in the Sideboard", () => {
        // A derived colour count is incoherent if the duals that justified it
        // sit in the Sideboard: the deck would have a colour it cannot cast.
        const { pool, getMeta } = threeColorFixture(true);
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand);
        expect(built.colors).toHaveLength(3);
        const scrublandId = getCardByName("Scrubland").id;
        expect(
            built.cards.filter((c) => c.cardId === scrublandId)
        ).toHaveLength(3);
        expect(
            built.sideboard.filter((c) => c.cardId === scrublandId)
        ).toHaveLength(0);
    });
});

// --- Capability-aware spell selection (issue #1615, ADR 0072) --------------
//
// ADR 0072's own worked example, run through the BUILDER: a Pool drafted
// around Flash + Worldspine Wurm must not build with Flash cut. Flash requires
// `value-on-death`; the Wurm provides it (its death trigger makes three 5/5
// tokens regardless of how it died) — the exact pairing the Capability layer
// exists to see and `cardValueById` cannot.

function profileLookup(profiles: Record<string, CardProfile>): GetCardProfile {
    return (cardId) => profiles[cardId] ?? null;
}

/** Flash + Worldspine Wurm + 30 copies of a filler spell that outscores Flash
 *  on standalone quality alone. `manaValue` is overridden to 2 so the filler
 *  competes with Flash in its OWN curve bucket — otherwise the curve phase
 *  maindecks Flash for free as the only 2-drop and the test proves nothing.
 *
 *  The filler must beat Flash on standalone quality by LESS than a full-weight
 *  Capability match is worth, or the design guarantee the two tests below
 *  assert is simply not true of this pair and they fail for a reason that has
 *  nothing to do with Capabilities. It is Wall of Air no longer (issue #3292):
 *  Flash's Effect Script stopped being read as a +120 edict — its trailing
 *  `if (not $paid) -> sacrifice($picked)` sacrifices the CASTER's own creature
 *  — so `cardValueById` now floors it at `base + MV` and the Wall's gap grew
 *  from a fraction of the match to roughly twelve times it. Jump keeps every
 *  property the fixture needs (blue like Flash, a plain one-shot spell, no
 *  Capability rows of its own) with a gap the match can still close; the
 *  relation, not the number, is what the second test re-derives every run. */
function flashFixture() {
    const flash = metaOf("Flash");
    const wurm = metaOf("Worldspine Wurm");
    const filler: AutoBuildCardMeta = {
        ...metaOf("Jump"),
        manaValue: 2,
    };
    const entries: Record<string, AutoBuildCardMeta> = {
        flash,
        wurm,
    };
    const pool: LimitedPoolCard[] = [
        poolCard("flash", flash),
        poolCard("wurm", wurm),
    ];
    // Half the filler is green (same card, same quality) so the deck runs
    // enough Forests to cast the Wurm's {G}{G}{G}: the subject here is the
    // Capability term, not castability.
    const greenFiller: AutoBuildCardMeta = {
        ...filler,
        pips: { G: 1 },
        colors: ["G"],
    };
    for (let i = 0; i < 30; i++) {
        const meta = i % 2 === 0 ? filler : greenFiller;
        entries[`f${i}`] = meta;
        pool.push(poolCard(`f${i}`, meta));
    }
    return { pool, getMeta: metaLookup(entries), flash, wurm, filler };
}

describe("Capability-aware spell selection (issue #1615)", () => {
    const { pool, getMeta, flash, wurm, filler } = flashFixture();
    const inMaindeck = (built: { cards: { cardId: string }[] }, id: string) =>
        built.cards.some((c) => c.cardId === id);

    it("cuts a weak-in-isolation enabler when nothing knows what it does (the DEFECT)", () => {
        // No Card Profiles: Flash is a 2-mana instant whose `cardValueById`
        // sits just below the filler's, so it loses its slot — exactly the
        // failure the issue names. This is the mutation-guard for the test
        // below: if Flash were maindecked here too, the positive test would
        // pass for free.
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand);
        expect(inMaindeck(built, wurm.cardId)).toBe(true);
        expect(inMaindeck(built, flash.cardId)).toBe(false);
    });

    it("MAINDECKS the enabler once the payoff it serves is in the deck (the FIX)", () => {
        // `built.cards.length >= 40` alone proves nothing here: the Maindeck
        // size is `spellCount + landCount` BY CONSTRUCTION (40 always),
        // profiles or not — see `TARGET_MAIN_SIZE`. What the comment actually
        // claims is that the enabler took a FILLER's slot rather than growing
        // the deck, so prove that directly: same total size as the no-profile
        // build, and exactly one filler copy (identified by its unique
        // `cardName`, since every filler copy shares the same `cardId`)
        // present in the no-profile build is gone from this one.
        const withoutProfile = autoBuildDeck(pool, getMeta, resolveBasicLand);
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getCardProfile: profileLookup({
                [flash.cardId]: {
                    archetypes: [],
                    provides: [],
                    requires: ["value-on-death"],
                    archetypesReviewed: true,
                    capabilitiesReviewed: true,
                },
                [wurm.cardId]: {
                    archetypes: [],
                    provides: ["value-on-death"],
                    requires: [],
                    archetypesReviewed: true,
                    capabilitiesReviewed: true,
                },
            }),
        });
        expect(inMaindeck(built, wurm.cardId)).toBe(true);
        expect(inMaindeck(built, flash.cardId)).toBe(true);
        expect(built.cards.length).toBe(withoutProfile.cards.length);

        const withoutNames = withoutProfile.cards.map((c) => c.cardName);
        const builtNames = new Set(built.cards.map((c) => c.cardName));
        const displaced = withoutNames.filter((name) => !builtNames.has(name));
        expect(displaced).toHaveLength(1);
        // The displaced card is one of the filler copies (its pool identity
        // is its own scryfallId, `f0`..`f29` — see `poolCard`), never the
        // enabler or the payoff themselves.
        expect(displaced[0]).toMatch(/^f\d+$/);
    });

    it("an UNREVIEWED profile row still counts, at half weight (ADR 0072)", () => {
        // The design guarantee (ADR 0072) is a RELATION, not two hardcoded
        // numbers: a half-weight (unreviewed) Capability match must not close
        // Flash's standalone-quality gap to the filler, while a full-weight
        // (reviewed) match — proven by the FIX test above — does. Deriving
        // both sides from the actual metas (rather than a comment asserting
        // "0.075 < 0.1106 < 0.150") means a future `cardValueById` retune that
        // shrinks or grows the gap can't leave this test silently passing (or
        // failing) for the wrong reason — it re-derives the gap from
        // `flash`/`filler` every run.
        const flashBase = heuristicAsRating(candidateQuality(flash));
        const fillerBase = heuristicAsRating(candidateQuality(filler));
        const gap = fillerBase - flashBase;
        expect(gap).toBeGreaterThan(0);

        const requiresValueOnDeath = {
            archetypes: [],
            provides: [],
            requires: ["value-on-death"],
        };
        const providesValueOnDeath = {
            archetypes: [],
            provides: ["value-on-death"],
            requires: [],
        };
        const profiled = poolProfiles(
            [flash, wurm],
            profileLookup({
                [flash.cardId]: {
                    ...requiresValueOnDeath,
                    archetypesReviewed: true,
                    capabilitiesReviewed: true,
                },
                [wurm.cardId]: {
                    ...providesValueOnDeath,
                    archetypesReviewed: true,
                    capabilitiesReviewed: true,
                },
            })
        );
        const fullWeightFit = capabilityFitTerm(
            flash,
            {
                ...requiresValueOnDeath,
                archetypesReviewed: true,
                capabilitiesReviewed: true,
            },
            profiled
        ).rawValue;
        const halfWeightProfiled = poolProfiles(
            [flash, wurm],
            profileLookup({
                [flash.cardId]: {
                    ...requiresValueOnDeath,
                    archetypesReviewed: false,
                    capabilitiesReviewed: false,
                },
                [wurm.cardId]: {
                    ...providesValueOnDeath,
                    archetypesReviewed: false,
                    capabilitiesReviewed: false,
                },
            })
        );
        const halfWeightFit = capabilityFitTerm(
            flash,
            {
                ...requiresValueOnDeath,
                archetypesReviewed: false,
                capabilitiesReviewed: false,
            },
            halfWeightProfiled
        ).rawValue;

        // Half a match is worth less than the gap it would need to close...
        expect(halfWeightFit).toBeLessThan(gap);
        // ...while a full match (proven maindecked above) exceeds it.
        expect(fullWeightFit).toBeGreaterThan(gap);

        const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getCardProfile: profileLookup({
                [flash.cardId]: {
                    archetypes: [],
                    provides: [],
                    requires: ["value-on-death"],
                    archetypesReviewed: false,
                    capabilitiesReviewed: false,
                },
                [wurm.cardId]: {
                    archetypes: [],
                    provides: ["value-on-death"],
                    requires: [],
                    archetypesReviewed: false,
                    capabilitiesReviewed: false,
                },
            }),
        });
        expect(inMaindeck(built, flash.cardId)).toBe(false);
    });

    it("absence of a match is the veto: an unrelated Capability rescues nothing", () => {
        // ADR 0072's negative case — Animate Dead requires `reanimatable`,
        // which the Wurm does not provide (it shuffles itself out of the
        // graveyard). Profiled, matched against nothing, scores nothing.
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getCardProfile: profileLookup({
                [flash.cardId]: {
                    archetypes: [],
                    provides: [],
                    requires: ["reanimatable"],
                    archetypesReviewed: true,
                    capabilitiesReviewed: true,
                },
                [wurm.cardId]: {
                    archetypes: [],
                    provides: ["value-on-death"],
                    requires: [],
                    archetypesReviewed: true,
                    capabilitiesReviewed: true,
                },
            }),
        });
        expect(inMaindeck(built, flash.cardId)).toBe(false);
    });

    it("every Pool card is still placed exactly once, with or without profiles", () => {
        for (const getCardProfile of [
            undefined,
            profileLookup({
                [flash.cardId]: {
                    archetypes: [],
                    provides: [],
                    requires: ["value-on-death"],
                    archetypesReviewed: true,
                    capabilitiesReviewed: true,
                },
                [wurm.cardId]: {
                    archetypes: [],
                    provides: ["value-on-death"],
                    requires: [],
                    archetypesReviewed: true,
                    capabilitiesReviewed: true,
                },
            }),
        ]) {
            const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
                getCardProfile,
            });
            const fromPool = [...built.cards, ...built.sideboard].filter((c) =>
                pool.some((p) => p.cardId === c.cardId)
            );
            expect(fromPool.length).toBe(pool.length);
        }
    });

    // Discriminates the design's central choice (issue #1615's own review):
    // pass 2 (`capabilityAwareSpellScore`) must score Capability matches
    // against the PROVISIONAL Maindeck `selectSpells` already built, never
    // against the whole Pool. Feeding it `resolvedMetas(resolved)` (the whole
    // Pool) instead would keep every OTHER test in this file green, because
    // in all of them the payoff that provides the Capability is itself
    // maindecked — so "provisional Maindeck" and "whole Pool" agree. This
    // fixture is built specifically so they DISAGREE: the payoff is real, in
    // the Pool, and profiled — but is cut by pass 1 on standalone quality
    // alone, so it never reaches the provisional Maindeck at all.
    it("scores pass 2 against the provisional Maindeck, NOT the whole Pool", () => {
        const enabler = metaOf("Flash");
        // A real, distinctly weak 2-mana card — far below `filler`'s standalone
        // quality, so it is guaranteed to lose every curve-bucket-2 slot to
        // the 30 filler copies below and never reach the provisional Maindeck,
        // while still being profiled and genuinely present in the Pool.
        const payoff: AutoBuildCardMeta = {
            ...metaOf("Aeolipile"),
            manaValue: 2,
        };
        const entries: Record<string, AutoBuildCardMeta> = {
            enabler,
            payoff,
        };
        const poolCards: LimitedPoolCard[] = [
            poolCard("enabler", enabler),
            poolCard("payoff", payoff),
        ];
        for (let i = 0; i < 30; i++) {
            entries[`f${i}`] = filler;
            poolCards.push(poolCard(`f${i}`, filler));
        }
        const getPoolMeta = metaLookup(entries);
        const getCardProfile = profileLookup({
            [enabler.cardId]: {
                archetypes: [],
                provides: [],
                requires: ["value-on-death"],
                archetypesReviewed: true,
                capabilitiesReviewed: true,
            },
            [payoff.cardId]: {
                archetypes: [],
                provides: ["value-on-death"],
                requires: [],
                archetypesReviewed: true,
                capabilitiesReviewed: true,
            },
        });

        const built = autoBuildDeck(poolCards, getPoolMeta, resolveBasicLand, {
            getCardProfile,
        });

        // The payoff must genuinely be cut by pass 1 — otherwise this
        // fixture doesn't exercise the provisional-vs-whole-Pool distinction
        // at all, and the assertion below would pass for the wrong reason.
        expect(inMaindeck(built, payoff.cardId)).toBe(false);
        // Because the payoff never reaches the provisional Maindeck, the
        // CORRECT implementation gives the enabler no Capability credit for
        // it: the enabler stays cut, exactly like the no-profile baseline.
        // (Mutation-checked: swapping `provisional.map((r) => r.meta!)` for
        // `resolvedMetas(resolved)` in `capabilityAwareSpellScore`'s call site
        // in `autoBuild.ts` turns this assertion red — the payoff's profile
        // then reaches the enabler's scoring pass via the whole Pool, closes
        // its standalone-quality gap to the filler, and the enabler gets
        // maindecked on a payoff that was never actually in the deck.)
        expect(inMaindeck(built, enabler.cardId)).toBe(false);
    });
});

// --- autoBuildDeck: size, split, curve, no-foreign-cards --------------------

describe("autoBuildDeck (issue #1115)", () => {
    it("builds a legal-sized (>=40), curve-aware, on-color deck with basics of the drafted set, from a full LEA Sealed pool", () => {
        const packSlots = ["lea"];
        let seats = buildEmptySeats(2);
        seats = fillBotSeats(seats);
        seats = generateSealedPools(
            seats,
            packSlots,
            6,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(4242)
        );
        const pool = seats[0].pool!;
        expect(pool.length).toBeGreaterThan(60); // 6 boosters, ~90 cards

        const built = autoBuildDeck(
            pool,
            getAutoBuildCardMeta,
            resolveBasicLand
        );

        // Size: always at least the format's legality floor (real Limited
        // practice, not the issue's literal "~17 spells + 17 lands" — see
        // `autoBuild.ts`'s module comment for why).
        expect(built.cards.length).toBeGreaterThanOrEqual(40);
        // The colour COUNT is derived (issue #1615), so this asserts the
        // BOUNDS rather than pinning a number a seed change could move: at
        // least two colours, never more than `MAX_DECK_COLORS`, all distinct.
        expect(built.colors.length).toBeGreaterThanOrEqual(2);
        expect(built.colors.length).toBeLessThanOrEqual(MAX_DECK_COLORS);
        expect(new Set(built.colors).size).toBe(built.colors.length);

        // "~17" land count (issue AC: "~17/17 split") — a healthy Sealed
        // pool builds close to the classic 17, never far below it.
        const basicNames = new Set([
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]);
        // Counts every LAND in the Maindeck — the invented basics plus any
        // of the Pool's own non-basic fixing the builder maindecked (issue
        // #1615), which together are the land base the 17-slot budget covers.
        const landCards = built.cards.filter(
            (c) =>
                basicNames.has(c.cardName) ||
                (tryGetDefinition(c.cardId)?.types.includes("Land") ?? false)
        );
        expect(landCards.length).toBeGreaterThanOrEqual(17);
        expect(landCards.length).toBeLessThanOrEqual(20);
        // Every BASIC is a basic of one of the chosen colors.
        const colorLandNames = new Set(
            built.colors.map(
                (c) =>
                    ({
                        W: "Plains",
                        U: "Island",
                        B: "Swamp",
                        R: "Mountain",
                        G: "Forest",
                    })[c]
            )
        );
        for (const land of landCards) {
            if (!basicNames.has(land.cardName)) continue;
            expect(colorLandNames.has(land.cardName)).toBe(true);
        }

        // "no foreign cards": every non-land Maindeck card AND every
        // Sideboard card traces back to a real Pool entry (basics are the
        // ONLY cards Auto-Build ever invents, and they're never counted
        // against the Pool by `checkPoolMembership`'s basic exemption).
        const poolCardIds = new Set(pool.map((c) => c.cardId));
        const nonLandMain = built.cards.filter(
            (c) => !basicNames.has(c.cardName)
        );
        for (const c of [...nonLandMain, ...built.sideboard]) {
            expect(poolCardIds.has(c.cardId)).toBe(true);
        }

        // "every Pool card placed somewhere": the non-land Maindeck +
        // Sideboard together account for every Pool entry exactly once
        // (this is exactly `checkPoolMembership`'s invariant — asserted
        // directly via `validateDeck` in the property test below, and
        // spot-checked here by raw count).
        expect(nonLandMain.length + built.sideboard.length).toBe(pool.length);
    });

    it("curve-fills: the built spell base isn't clustered at one mana value", () => {
        const packSlots = ["lea"];
        let seats = buildEmptySeats(2);
        seats = fillBotSeats(seats);
        seats = generateSealedPools(
            seats,
            packSlots,
            6,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(99)
        );
        const pool = seats[0].pool!;
        const built = autoBuildDeck(
            pool,
            getAutoBuildCardMeta,
            resolveBasicLand
        );

        const basicNames = new Set([
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]);
        const spells = built.cards.filter((c) => !basicNames.has(c.cardName));
        const buckets = new Map<number, number>();
        for (const c of spells) {
            const def = tryGetDefinition(c.cardId)!;
            const mv = Math.max(
                1,
                Math.min(6, Math.round(manaValue(def.manaCost)))
            );
            buckets.set(mv, (buckets.get(mv) ?? 0) + 1);
        }
        // Curve-aware: no single mana-value bucket holds every spell — a
        // non-curve-aware "just take the N best cards" build on a real LEA
        // pool would very plausibly cluster (LEA has a deep 2-3 drop
        // common slot). This is a coarse, non-brittle curve-shape check.
        const maxBucketShare = Math.max(...buckets.values()) / spells.length;
        expect(maxBucketShare).toBeLessThan(0.6);
        // At least 3 distinct buckets populated — real curve spread, not a
        // single-cost pile.
        expect(buckets.size).toBeGreaterThanOrEqual(3);
    });

    it("still reaches the 40-card floor from a thin/foreign-light synthetic pool by growing the land count", () => {
        // A tiny synthetic pool (well under 23 on-color spells) — Auto-Build
        // must still ship a >=40 Maindeck by adding MORE basics, never a
        // short deck.
        const bolt = metaOf("Lightning Bolt");
        const shock = metaOf("Lightning Bolt"); // reuse id, distinct pool entry
        const entries = { r1: bolt, r2: shock };
        const pool: LimitedPoolCard[] = [
            poolCard("r1", bolt),
            poolCard("r2", shock),
        ];
        const built = autoBuildDeck(
            pool,
            metaLookup(entries),
            resolveBasicLandFor("lea")
        );
        expect(built.cards.length).toBeGreaterThanOrEqual(40);
        // Both tiny pool entries are placed somewhere (never dropped), and
        // never duplicated: nonland Maindeck + Sideboard together equal the
        // Pool's own size exactly.
        const basicNames = new Set([
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]);
        const nonLandMain = built.cards.filter(
            (c) => !basicNames.has(c.cardName)
        );
        expect(nonLandMain.length + built.sideboard.length).toBe(pool.length);
    });
});

// --- Event-completion gating -----------------------------------------------

describe("isEventPoolFinal / computeBotAutoBuiltDeck (issue #1115)", () => {
    const bolt = metaOf("Lightning Bolt");
    const pool: LimitedPoolCard[] = [poolCard("r1", bolt)];
    const meta = metaLookup({ r1: bolt });
    const land = resolveBasicLandFor("lea");

    it("a Sealed event's Pool is final the instant it's started", () => {
        const open: AutoBuildEventContext = { type: "sealed", status: "open" };
        const started: AutoBuildEventContext = {
            type: "sealed",
            status: "started",
        };
        expect(isEventPoolFinal(open)).toBe(false);
        expect(isEventPoolFinal(started)).toBe(true);
    });

    it("a Draft event's Pool is final only once draftCompletedAt is set", () => {
        const midDraft: AutoBuildEventContext = {
            type: "draft",
            status: "started",
        };
        const completed: AutoBuildEventContext = {
            type: "draft",
            status: "started",
            draftCompletedAt: 12345,
        };
        expect(isEventPoolFinal(midDraft)).toBe(false);
        expect(isEventPoolFinal(completed)).toBe(true);
    });

    // The regression the play phase introduced (ADR 0076, issue #1640): this
    // gate used to read `status !== "started"`, so the instant `playing`
    // existed EVERY bot seat's Auto-Built deck — the deck its round pairings
    // are played and evaluated against — would have vanished mid-event. A
    // Pool is never un-dealt, so `arePoolsDealt` must keep it final through
    // the rounds and past the event's end. Asserted HERE, at the consumer
    // that was actually broken: `eventStatus.test.ts` pins
    // `arePoolsDealt("playing")` but never reaches this gate.
    it("a Pool stays final through the play phase and past the event's end", () => {
        const sealedPlaying: AutoBuildEventContext = {
            type: "sealed",
            status: "playing",
        };
        const sealedFinished: AutoBuildEventContext = {
            type: "sealed",
            status: "finished",
        };
        const draftPlaying: AutoBuildEventContext = {
            type: "draft",
            status: "playing",
            draftCompletedAt: 12345,
        };
        const draftFinished: AutoBuildEventContext = {
            type: "draft",
            status: "finished",
            draftCompletedAt: 12345,
        };

        expect(isEventPoolFinal(sealedPlaying)).toBe(true);
        expect(isEventPoolFinal(sealedFinished)).toBe(true);
        expect(isEventPoolFinal(draftPlaying)).toBe(true);
        expect(isEventPoolFinal(draftFinished)).toBe(true);

        // …and the consequence that matters: the bot seat still HAS its deck
        // once the rounds are running and after they end.
        expect(
            computeBotAutoBuiltDeck(
                { isBot: true, pool },
                sealedPlaying,
                meta,
                land
            )
        ).not.toBeNull();
        expect(
            computeBotAutoBuiltDeck(
                { isBot: true, pool },
                draftFinished,
                meta,
                land
            )
        ).not.toBeNull();
    });

    it("computeBotAutoBuiltDeck is null for a human seat, null before the Pool is final, and a deck once it is", () => {
        const started: AutoBuildEventContext = {
            type: "sealed",
            status: "started",
        };
        const open: AutoBuildEventContext = { type: "sealed", status: "open" };

        expect(
            computeBotAutoBuiltDeck({ isBot: false, pool }, started, meta, land)
        ).toBeNull();
        expect(
            computeBotAutoBuiltDeck({ isBot: true, pool }, open, meta, land)
        ).toBeNull();
        expect(
            computeBotAutoBuiltDeck(
                { isBot: true, pool: [] },
                started,
                meta,
                land
            )
        ).toBeNull();
        expect(
            computeBotAutoBuiltDeck({ isBot: true, pool }, started, meta, land)
        ).not.toBeNull();
    });
});

// --- Property test: every bot seat's Auto-Built deck is limited-legal ------
//
// PRD #1107 acceptance: "each is limited-legal against its own Pool" —
// asserted over MANY seeded drafts (both Sealed and Draft event types), via
// the SAME `validateDeck`/`checkPoolMembership` seam `convex/formats.ts`'s
// authoritative game-start gate uses. This is the hard requirement driving
// `autoBuild.ts`'s size/color/curve choices (see its module comment).

function resolvePoolFor(pool: readonly LimitedPoolCard[]): ResolvePool {
    const grouped: Pool = poolFromLimitedPoolCards(pool, resolveDeckCardMeta);
    return () => grouped;
}

describe("property: Auto-Built decks are always limited-legal against their own Pool (issue #1115)", () => {
    it("every bot seat, across 25 seeded Sealed events of varying seat counts, builds a limited-legal deck", () => {
        const packSlots = ["lea"];
        let checked = 0;
        for (let seed = 1; seed <= 25; seed++) {
            const seatCount = 2 + (seed % 7); // 2..8
            let seats = buildEmptySeats(seatCount);
            seats = fillBotSeats(seats); // every seat is a bot — solo-drafter shape
            seats = generateSealedPools(
                seats,
                packSlots,
                6,
                getBoosterConfig,
                resolveCardMeta,
                makeRng(seed * 1000 + 7)
            );
            const eventContext: AutoBuildEventContext = {
                type: "sealed",
                status: "started",
            };
            for (const seat of seats) {
                const built = computeBotAutoBuiltDeck(
                    seat,
                    eventContext,
                    getAutoBuildCardMeta,
                    resolveBasicLand
                );
                expect(built).not.toBeNull();
                const legality = validateDeck(
                    { cards: built!.cards, sideboard: built!.sideboard },
                    "limited",
                    resolveDeckCardMeta,
                    undefined,
                    resolvePoolFor(seat.pool!)
                );
                expect(legality.reasons).toEqual([]);
                expect(legality.isLegal).toBe(true);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(50); // sanity: the loop actually ran
    });

    it("every bot seat, across 10 seeded ALL-BOT Draft events (solo-drafter shape), builds a limited-legal deck", () => {
        const packSlots = ["lea", "lea", "lea"];
        let checked = 0;
        for (let seed = 1; seed <= 10; seed++) {
            const seatCount = 2 + (seed % 7); // 2..8
            const seats = fillBotSeats(buildEmptySeats(seatCount));
            const eventSeed = seed * 777 + 3;

            const dealt = startDraft(
                seats,
                packSlots,
                eventSeed,
                getBoosterConfig,
                resolveCardMeta
            );
            const result = runBotAutoPicks(
                dealt.seats,
                dealt.draftRound,
                dealt.draftPacksRemaining,
                packSlots,
                eventSeed,
                getBoosterConfig,
                resolveCardMeta,
                botChoosePick
            );
            expect(result.completed).toBe(true);

            const eventContext: AutoBuildEventContext = {
                type: "draft",
                status: "started",
                draftCompletedAt: 999,
            };
            for (const seat of result.seats) {
                const built = computeBotAutoBuiltDeck(
                    seat,
                    eventContext,
                    getAutoBuildCardMeta,
                    resolveBasicLand
                );
                expect(built).not.toBeNull();
                const legality = validateDeck(
                    { cards: built!.cards, sideboard: built!.sideboard },
                    "limited",
                    resolveDeckCardMeta,
                    undefined,
                    resolvePoolFor(seat.pool!)
                );
                expect(legality.reasons).toEqual([]);
                expect(legality.isLegal).toBe(true);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(20);
    });
});

// --- Build Invariants (PRD #8772, issue #8897) -----------------------------
//
// Pick Invariant style: each asserts the DIRECTION of a build choice on a
// Pool fixture, never a specific deck.

/** A Pool of `count` copies per row, each copy its own Pool entry
 *  (`<key><i>`), with the matching meta lookup. */
function invariantPool(rows: readonly [string, AutoBuildCardMeta, number][]): {
    pool: LimitedPoolCard[];
    getMeta: GetAutoBuildCardMeta;
} {
    const entries: Record<string, AutoBuildCardMeta> = {};
    const pool: LimitedPoolCard[] = [];
    for (const [key, meta, count] of rows) {
        for (let i = 0; i < count; i++) {
            entries[`${key}${i}`] = meta;
            pool.push(poolCard(`${key}${i}`, meta));
        }
    }
    return { pool, getMeta: metaLookup(entries) };
}

/** The Maindeck's resolved metas (invented basics resolve through the
 *  registry, Pool cards through the fixture). */
function maindeckMetas(
    built: { cards: { cardId: string; cardName: string }[] },
    getMeta: GetAutoBuildCardMeta
): AutoBuildCardMeta[] {
    return built.cards.map((c) => getMeta(c.cardName) ?? metaOf(c.cardName));
}

/** A red/green Pool deep enough in castable spells to fill every slot. */
function redGreenBase(): [string, AutoBuildCardMeta, number][] {
    return [
        ["ogre", metaOf("Gray Ogre"), 10],
        ["giant", metaOf("Hill Giant"), 8],
        ["bears", metaOf("Grizzly Bears"), 10],
        ["elves", metaOf("Llanowar Elves"), 3],
    ];
}

describe("Build Invariants (PRD #8772)", () => {
    it("no gold card with an unpayable pip: a {R}{B} bomb stays out of a R/G deck", () => {
        const bomb = {
            ...spellWithPips(metaOf("Shivan Dragon"), { R: 1, B: 1 }),
            manaValue: 3,
        };
        // Six R/B duals give the deck black SOURCES, so the black pip is not
        // simply uncastable (the castability floor would cut it then): what
        // keeps the bomb out is that black is not a colour of the deck.
        // Three {U}{U} spells with no blue source make blue the third-ranked
        // colour, and the one the mana base cannot pay, so the deck stays
        // R/G and black is never considered.
        const { pool, getMeta } = invariantPool([
            ...redGreenBase(),
            ["dual", metaOf("Badlands"), 6],
            ["air", metaOf("Air Elemental"), 3],
            ["gold", bomb, 2],
        ]);
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand);
        expect([...built.colors].sort()).toEqual(["G", "R"]);
        expect(
            built.cards.filter((c) => c.cardName.startsWith("dual"))
        ).toHaveLength(6);
        const deck = new Set<Color>(built.colors);
        for (const m of maindeckMetas(built, getMeta)) {
            for (const [c, n] of Object.entries(m.pips) as [Color, number][]) {
                if (n > 0) expect(deck.has(c)).toBe(true);
            }
        }
        // The guard is the PIP rule, not the bomb's value: the same card at
        // a payable cost is maindecked.
        const payable = {
            ...spellWithPips(metaOf("Shivan Dragon"), { R: 1, G: 1 }),
            manaValue: 3,
        };
        const control = invariantPool([
            ...redGreenBase(),
            ["gold", payable, 2],
        ]);
        const builtControl = autoBuildDeck(
            control.pool,
            control.getMeta,
            resolveBasicLand
        );
        expect(
            builtControl.cards.filter((c) => c.cardName.startsWith("gold"))
        ).toHaveLength(2);
    });

    it("castability floor: a {G}{G}{G} splash-depth bomb loses its slot to castable spells", () => {
        // Green is the light colour (few green pips), so its basics are few:
        // a triple-green six-drop is rarely payable by turn six.
        const rows: [string, AutoBuildCardMeta, number][] = [
            ["ogre", metaOf("Gray Ogre"), 10],
            ["giant", metaOf("Hill Giant"), 8],
            ["bolt", metaOf("Lightning Bolt"), 4],
            ["minotaur", metaOf("Hurloon Minotaur"), 4],
            ["bears", metaOf("Grizzly Bears"), 6],
        ];
        const heavy = spellWithPips(metaOf("Shivan Dragon"), { G: 3 });
        const strained = invariantPool([...rows, ["bomb", heavy, 1]]);
        const built = autoBuildDeck(
            strained.pool,
            strained.getMeta,
            resolveBasicLand
        );
        expect(built.colors).toContain("G");
        expect(built.cards.some((c) => c.cardName === "bomb0")).toBe(false);
        // Discriminating twin: the same bomb at ONE green pip is castable
        // and plays.
        const light = spellWithPips(metaOf("Shivan Dragon"), { G: 1 });
        const castable = invariantPool([...rows, ["bomb", light, 1]]);
        const builtCastable = autoBuildDeck(
            castable.pool,
            castable.getMeta,
            resolveBasicLand
        );
        expect(builtCastable.cards.some((c) => c.cardName === "bomb0")).toBe(
            true
        );
    });

    it("raising a card's Pick Rating moves it into the build", () => {
        // Lightning Bolt's heuristic value is the Pool's lowest, so unrated
        // it is cut; rated at the top of the scale it plays.
        const bolt = metaOf("Lightning Bolt");
        const { pool, getMeta } = invariantPool([
            ...redGreenBase(),
            ["bolt", bolt, 1],
        ]);
        const unrated = autoBuildDeck(pool, getMeta, resolveBasicLand);
        expect(unrated.cards.some((c) => c.cardName === "bolt0")).toBe(false);
        const rated = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getPickRating: (cardId) => (cardId === bolt.cardId ? 5 : null),
        });
        expect(rated.cards.some((c) => c.cardName === "bolt0")).toBe(true);
        expect(rated.cards).toHaveLength(unrated.cards.length);
    });

    it("a low-curve Pool plays fewer lands than a high-curve one, never under the format floor", () => {
        const low = invariantPool([
            ["elves", metaOf("Llanowar Elves"), 8],
            ["bolt", metaOf("Lightning Bolt"), 8],
            ["bears", metaOf("Grizzly Bears"), 8],
            ["ogre", metaOf("Gray Ogre"), 6],
        ]);
        const high = invariantPool([
            ["giant", metaOf("Hill Giant"), 6],
            ["wurm", metaOf("Craw Wurm"), 8],
            ["dragon", metaOf("Shivan Dragon"), 8],
            ["treefolk", metaOf("Ironroot Treefolk"), 8],
        ]);
        const lands = (p: typeof low) => {
            const built = autoBuildDeck(p.pool, p.getMeta, resolveBasicLand);
            expect(built.cards.length).toBeGreaterThanOrEqual(40);
            return maindeckMetas(built, p.getMeta).filter((m) => m.isLand)
                .length;
        };
        expect(lands(low)).toBeLessThan(lands(high));
    });
});

// --- Plan-first Auto-Build (issue #8898) -----------------------------------

/** The share of the Maindeck's spells the deepest plan must keep — the Build
 *  Invariant's declared threshold. The fixture's plan holds 11 of ~23 spell
 *  slots once it decides the colours; a build that ignores it plays none. */
const PLAN_SHARE_THRESHOLD = 0.4;

function archetypeProfile(
    archetypes: string[],
    archetypesReviewed = true
): CardProfile {
    return {
        archetypes,
        provides: [],
        requires: [],
        archetypesReviewed,
        capabilitiesReviewed: true,
    };
}

function profilesById(rows: readonly [string, CardProfile][]): GetCardProfile {
    const byId = new Map(rows.map(([name, p]) => [getCardByName(name).id, p]));
    return (cardId) => byId.get(cardId) ?? null;
}

/** Eleven single-pip R/G `aggro` cards against eight double-pip U/B
 *  `control` cards: by Colour Commitment the Pool is U/B (the control
 *  cards' pips outweigh the aggro cards'), by depth it is aggro. */
function rivalPlansPool() {
    return invariantPool([
        ["ogre", metaOf("Gray Ogre"), 6],
        ["bears", metaOf("Grizzly Bears"), 5],
        ["air", metaOf("Air Elemental"), 4],
        ["vampire", metaOf("Sengir Vampire"), 4],
        ["giant", metaOf("Hill Giant"), 4],
        ["wurm", metaOf("Craw Wurm"), 2],
        ["merfolk", metaOf("Merfolk of the Pearl Trident"), 4],
        ["zombies", metaOf("Scathe Zombies"), 4],
    ]);
}

const AGGRO_CARDS = ["Gray Ogre", "Grizzly Bears"];
const CONTROL_CARDS = ["Air Elemental", "Sengir Vampire"];

function rivalPlanProfiles(aggroReviewed = true): GetCardProfile {
    return profilesById([
        ...AGGRO_CARDS.map(
            (n) =>
                [n, archetypeProfile(["aggro"], aggroReviewed)] as [
                    string,
                    CardProfile,
                ]
        ),
        ...CONTROL_CARDS.map(
            (n) => [n, archetypeProfile(["control"])] as [string, CardProfile]
        ),
    ]);
}

/** The rival control cards are the better cards: top of the rating scale. */
const controlRatedHigher = (cardId: string): number | null =>
    CONTROL_CARDS.some((n) => getCardByName(n).id === cardId)
        ? 4.5
        : AGGRO_CARDS.some((n) => getCardByName(n).id === cardId)
          ? 2.5
          : null;

function planShareOf(
    built: { cards: { cardId: string; cardName: string }[] },
    getMeta: GetAutoBuildCardMeta,
    getCardProfile: GetCardProfile,
    archetype: string
): number {
    const spells = maindeckMetas(built, getMeta).filter((m) => !m.isLand);
    return (
        spells.filter((m) =>
            getCardProfile(m.cardId)?.archetypes.includes(archetype)
        ).length / spells.length
    );
}

describe("Plan-first Auto-Build (issue #8898)", () => {
    it("Build Invariant: the deepest plan survives the build against a higher-rated rival plan with fewer cards", () => {
        const { pool, getMeta } = rivalPlansPool();
        const getCardProfile = rivalPlanProfiles();
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getCardProfile,
            getPickRating: controlRatedHigher,
        });
        expect(built.cards.length).toBeGreaterThanOrEqual(40);
        expect(
            planShareOf(built, getMeta, getCardProfile, "aggro")
        ).toBeGreaterThan(PLAN_SHARE_THRESHOLD);
        // Every aggro card plays: the plan's cards go first.
        expect(
            built.cards.filter((c) => /^(ogre|bears)/.test(c.cardName))
        ).toHaveLength(11);
    });

    it("the plan's cards take their slots ahead of better-rated on-colour cards", () => {
        // R/G either way; 25 on-colour spells for 22 slots. Rated, the
        // fillers outscore the aggro cards, so a build that reads ratings
        // alone cuts three aggro cards.
        const { pool, getMeta } = invariantPool([
            ["ogre", metaOf("Gray Ogre"), 6],
            ["bears", metaOf("Grizzly Bears"), 5],
            ["giant", metaOf("Hill Giant"), 8],
            ["wurm", metaOf("Craw Wurm"), 6],
        ]);
        const getCardProfile = rivalPlanProfiles();
        const fillers = ["Hill Giant", "Craw Wurm"].map(
            (n) => getCardByName(n).id
        );
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getCardProfile,
            getPickRating: (cardId) => (fillers.includes(cardId) ? 4.5 : 2.5),
        });
        expect(
            built.cards.filter((c) => /^(ogre|bears)/.test(c.cardName))
        ).toHaveLength(11);
        expect(
            built.cards.filter((c) => /^(giant|wurm)/.test(c.cardName)).length
        ).toBeLessThan(14);
    });

    it("colours follow the plan's signature, not the Pool's pip-weighted commitment", () => {
        const { pool, getMeta } = rivalPlansPool();
        // Without profiles the double pips of the control cards win.
        expect(chooseDeckColors(pool, getMeta)).toEqual(["U", "B"]);
        expect(chooseDeckColors(pool, getMeta, rivalPlanProfiles())).toEqual([
            "R",
            "G",
        ]);
    });

    it("an unreviewed Archetype counts half: eleven unreviewed aggro cards lose the plan to eight reviewed control cards", () => {
        // 11 × 0.5 = 5.5 units of aggro against 8 of control.
        const { pool, getMeta } = rivalPlansPool();
        const getCardProfile = rivalPlanProfiles(false);
        expect(chooseDeckColors(pool, getMeta, getCardProfile)).toEqual([
            "U",
            "B",
        ]);
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getCardProfile,
        });
        expect(
            built.cards.filter((c) => /^(air|vampire)/.test(c.cardName))
        ).toHaveLength(8);
    });

    it("a third plan colour is admitted only when the Pool's dual lands pay for it", () => {
        // A W/R/G aggro plan, a third of its cards in each colour, beside the
        // same U/B control rival. White is the plan's lightest colour by
        // pips, so it ranks third; four W/B duals cover its share of 17
        // lands, and without them the deck stays on two.
        const dual = sourceProducing(metaOf("Scrubland"), ["W", "B"]);
        const rows: [string, AutoBuildCardMeta, number][] = [
            ["lions", metaOf("Savannah Lions"), 4],
            [
                "raiders",
                spellWithPips(metaOf("Mons's Goblin Raiders"), { R: 2 }),
                4,
            ],
            ["bears", spellWithPips(metaOf("Grizzly Bears"), { G: 2 }), 4],
            ["air", metaOf("Air Elemental"), 4],
            ["vampire", metaOf("Sengir Vampire"), 4],
            ["merfolk", metaOf("Merfolk of the Pearl Trident"), 4],
            ["zombies", metaOf("Scathe Zombies"), 4],
        ];
        const getCardProfile = profilesById([
            ["Savannah Lions", archetypeProfile(["aggro"])],
            ["Mons's Goblin Raiders", archetypeProfile(["aggro"])],
            ["Grizzly Bears", archetypeProfile(["aggro"])],
            ["Air Elemental", archetypeProfile(["control"])],
            ["Sengir Vampire", archetypeProfile(["control"])],
        ]);
        const withDuals = invariantPool([...rows, ["dual", dual, 4]]);
        const colours = chooseDeckColors(
            withDuals.pool,
            withDuals.getMeta,
            getCardProfile
        );
        expect(new Set(colours)).toEqual(new Set(["W", "R", "G"]));
        const built = autoBuildDeck(
            withDuals.pool,
            withDuals.getMeta,
            resolveBasicLand,
            { getCardProfile }
        );
        expect(built.colors).toHaveLength(3);
        expect(
            built.cards.filter((c) => c.cardName.startsWith("dual"))
        ).toHaveLength(4);

        const noDuals = invariantPool(rows);
        const two = chooseDeckColors(
            noDuals.pool,
            noDuals.getMeta,
            getCardProfile
        );
        expect(two).toEqual(["R", "G"]);
    });

    it("profile-less: the build is the plan-less build, card for card", () => {
        // No profile seam, a seam that profiles nothing, and one whose only
        // Archetype is too shallow to be a plan (three cards, under the
        // depth the pick scorer counts as settled) all build the same deck.
        const packSlots = ["lea"];
        let seats = buildEmptySeats(2);
        seats = fillBotSeats(seats);
        seats = generateSealedPools(
            seats,
            packSlots,
            6,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(8898)
        );
        const pool = seats[0].pool!;
        const getPickRating = (cardId: string) =>
            cardId.length % 2 === 0 ? 3 : null;
        const plain = autoBuildDeck(
            pool,
            getAutoBuildCardMeta,
            resolveBasicLand,
            { getPickRating }
        );
        const nothing = autoBuildDeck(
            pool,
            getAutoBuildCardMeta,
            resolveBasicLand,
            { getPickRating, getCardProfile: () => null }
        );
        const shallowId = getAutoBuildCardMeta(pool[0].scryfallId)!.cardId;
        const shallow = autoBuildDeck(
            pool,
            getAutoBuildCardMeta,
            resolveBasicLand,
            {
                getPickRating,
                getCardProfile: (cardId) =>
                    cardId === shallowId ? archetypeProfile(["aggro"]) : null,
            }
        );
        expect(nothing).toEqual(plain);
        expect(shallow).toEqual(plain);
    });
});

describe("plan depth read against the scope (issue #9298)", () => {
    // rivalPlansPool: 33 cards, 11 aggro against 8 control.
    const POOL_SIZE = 33;
    /** A scope where `aggro` tags half the cards and `control` one in
     *  twenty: eleven aggro cards are fewer than a 33-card Pool drawn from
     *  it would hold (16.5), eight control cards far more (1.65). */
    const broadAggroScope = new Map([
        ["aggro", 0.5],
        ["control", 0.05],
    ]);

    it("Discriminating Pair: the same Pool builds aggro by raw depth and control once the scope is read", () => {
        const { pool, getMeta } = rivalPlansPool();
        const getCardProfile = rivalPlanProfiles();
        expect(chooseDeckColors(pool, getMeta, getCardProfile)).toEqual([
            "R",
            "G",
        ]);
        expect(
            chooseDeckColors(pool, getMeta, getCardProfile, broadAggroScope)
        ).toEqual(["U", "B"]);
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getCardProfile,
            archetypeScopeShare: broadAggroScope,
        });
        expect(
            built.cards.filter((c) => /^(air|vampire)/.test(c.cardName))
        ).toHaveLength(8);
    });

    it("a rare tag below the settle bar is never the plan, however far above its share", () => {
        // Three control units against a scope share of zero: a surplus of 3,
        // but below ARCHETYPE_SETTLE_UNITS (4), so the settled aggro plan
        // stays even at a negative surplus.
        const commitment = new Map([
            ["aggro", 11],
            ["control", 3],
        ]);
        expect(
            choosePlanArchetype(commitment, POOL_SIZE, broadAggroScope)
        ).toBe("aggro");
    });

    it("a settled plan below its expectation is still chosen when every settled one is: the least diluted", () => {
        // aggro 11 − 16.5 = −5.5, control 8 − 9.9 = −1.9.
        const commitment = new Map([
            ["aggro", 11],
            ["control", 8],
        ]);
        const bothBroad = new Map([
            ["aggro", 0.5],
            ["control", 0.3],
        ]);
        expect(choosePlanArchetype(commitment, POOL_SIZE, bothBroad)).toBe(
            "control"
        );
    });

    it("with no scope share the plan is the raw deepest, ties by Archetype id", () => {
        const commitment = new Map([
            ["control", 8],
            ["aggro", 8],
        ]);
        expect(choosePlanArchetype(commitment, POOL_SIZE, null)).toBe("aggro");
        expect(choosePlanArchetype(new Map([["aggro", 3]]), 33, null)).toBe(
            null
        );
    });

    it("the scope share counts every distinct card in the denominator and an unreviewed layer at half", () => {
        const getCardProfile = profilesById([
            ["Gray Ogre", archetypeProfile(["aggro"])],
            ["Grizzly Bears", archetypeProfile(["aggro", "tokens"], false)],
        ]);
        const ids = [
            "Gray Ogre",
            "Grizzly Bears",
            "Gray Ogre",
            "Hill Giant",
        ].map((n) => getCardByName(n).id);
        const share = archetypeScopeShareOf(ids, getCardProfile)!;
        // Three distinct cards; aggro 1 + 0.5, tokens 0.5; Hill Giant unprofiled.
        expect(share.get("aggro")).toBeCloseTo(0.5);
        expect(share.get("tokens")).toBeCloseTo(1 / 6);
        expect(archetypeScopeShareOf([], getCardProfile)).toBeNull();
    });
});
