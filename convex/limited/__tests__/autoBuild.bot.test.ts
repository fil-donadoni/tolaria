// Auto-Build tests (PRD #1107 stories 24-25, ADR 0054/0055, issue #1115):
// deterministic unit tests for 2-color selection, curve-aware spell fill, and
// "no foreign cards" against the REAL LEA card registry + Booster Config —
// mirrors `botDrafter.test.ts`'s discipline (pure functions, no convex-test
// harness needed). A separate property test below asserts EVERY bot seat's
// Auto-Built deck validates as `limited`-legal against its own Pool, over
// many seeded Sealed AND Draft events.
import { describe, it, expect } from "vitest";
import {
    getCardByName,
    getPrintingsForCard,
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
    type TrueColor,
} from "../autoBuild";
import type { CardProfile, GetCardProfile } from "../cardProfiles";
import {
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
} from "../draftEngine";
import { chooseBotPick, type GetCardEvalMeta } from "../botDrafter";
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
    return (color: TrueColor) => {
        const name = {
            W: "Plains",
            U: "Island",
            B: "Swamp",
            R: "Mountain",
            G: "Forest",
        }[color];
        const def = getCardByName(name);
        const printing = getPrintingsForCard(def.id).find(
            (p) => p.setCode === setCode
        );
        return { cardId: printing?.printId ?? def.id, cardName: name };
    };
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
 *  maindecks Flash for free as the only 2-drop and the test proves nothing. */
function flashFixture() {
    const flash = metaOf("Flash");
    const wurm = metaOf("Worldspine Wurm");
    const filler: AutoBuildCardMeta = {
        ...metaOf("Wall of Air"),
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
    for (let i = 0; i < 30; i++) {
        entries[`f${i}`] = filler;
        pool.push(poolCard(`f${i}`, filler));
    }
    return { pool, getMeta: metaLookup(entries), flash, wurm };
}

describe("Capability-aware spell selection (issue #1615)", () => {
    const { pool, getMeta, flash, wurm } = flashFixture();
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
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getCardProfile: profileLookup({
                [flash.cardId]: {
                    archetypes: [],
                    provides: [],
                    requires: ["value-on-death"],
                    reviewed: true,
                },
                [wurm.cardId]: {
                    archetypes: [],
                    provides: ["value-on-death"],
                    requires: [],
                    reviewed: true,
                },
            }),
        });
        expect(inMaindeck(built, wurm.cardId)).toBe(true);
        expect(inMaindeck(built, flash.cardId)).toBe(true);
        // The enabler displaced a filler card, it did not grow the deck.
        expect(built.cards.length).toBeGreaterThanOrEqual(40);
    });

    it("an UNREVIEWED profile row still counts, at half weight (ADR 0072)", () => {
        // Half of one match is 0.075 rating points, which does NOT close
        // Flash's ~0.11 standalone-quality gap to the filler — the deliberate
        // consequence of ADR 0072's half-weight rule: an LLM's unreviewed
        // assertion is visible in the Draft Lab but does not decide the deck.
        const built = autoBuildDeck(pool, getMeta, resolveBasicLand, {
            getCardProfile: profileLookup({
                [flash.cardId]: {
                    archetypes: [],
                    provides: [],
                    requires: ["value-on-death"],
                    reviewed: false,
                },
                [wurm.cardId]: {
                    archetypes: [],
                    provides: ["value-on-death"],
                    requires: [],
                    reviewed: false,
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
                    reviewed: true,
                },
                [wurm.cardId]: {
                    archetypes: [],
                    provides: ["value-on-death"],
                    requires: [],
                    reviewed: true,
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
                    reviewed: true,
                },
                [wurm.cardId]: {
                    archetypes: [],
                    provides: ["value-on-death"],
                    requires: [],
                    reviewed: true,
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
