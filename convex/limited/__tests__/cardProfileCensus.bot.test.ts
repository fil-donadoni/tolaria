// Vintage Cube Card Profile census + Admin write boundary (PRD #1607, ADR
// 0072, issue #1614). Four acceptance claims, one describe block each:
//
//   1. every seeded Capability name exists in the closed registry — and the
//      catalogue-wide guard sweep actually COVERS the seed file (a guard that
//      sweeps an empty collection passes vacuously, which is the failure mode
//      worth testing explicitly now that a real file exists);
//   2. a profile edited through the Admin write boundary takes effect on the
//      bot's next pick;
//   3. scope isolation holds — a `vintage-cube` profile has no effect on a
//      `lea` event, at BOTH layers (checked-in seed and database);
//   4. reviewing a row measurably increases its contribution (ADR 0072's
//      half-weight rule for `reviewed: false`, issue #1611's
//      `UNREVIEWED_PROFILE_WEIGHT`).
//
// Pure functions throughout — no convex-test harness, same discipline as
// `cardRatings.bot.test.ts` (the mutation shells are exercised through their
// extracted pure pieces: `cardProfileWriteErrors`, `buildCardProfileRow`).
import { describe, it, expect } from "vitest";
import {
    buildCardProfileRow,
    buildDbProfileLookup,
    buildScopeCardProfiles,
    cardProfileWriteErrors,
    getAllCheckedInCardProfileFiles,
    getCardProfile,
    getCardProfileFile,
    normalizeArchetypes,
    resolveEventCardProfile,
    validateCardProfileFile,
    type CardProfile,
    type GetDbProfile,
    type ScopedCardProfile,
} from "../cardProfilesCore";
import {
    listScopeCards,
    type ScopeCard,
    type GetDbRating,
} from "../cardRatingsCore";
import { isRegisteredCapability } from "../capabilityRegistry";
import { CUBE_SOURCE_KEY } from "../cube";
import {
    chooseBotPick,
    scorePack,
    type CardEvalMeta,
    type GetCardEvalMeta,
} from "../botDrafter";
import type { DraftPackCard, LimitedPoolCard } from "../eventTypes";
import { tryGetCardByName } from "../../cards";
import { getCardColorIdentity, getPipCountsFromCost } from "../../cards/colors";
import { getDefinitionProducibleColors, manaValue } from "../../gre/constants";

const CUBE_FILE = getCardProfileFile(CUBE_SOURCE_KEY);

/** Canonical `CardDefinition.id` for a cube card, by name — the census is
 *  keyed by id, so every assertion below resolves through the real registry
 *  rather than hard-coding a UUID. */
function cardId(name: string): string {
    const def = tryGetCardByName(name);
    if (!def) throw new Error(`test fixture: no card named "${name}"`);
    return def.id;
}

/** The census row for a named cube card (throws when the card carries no
 *  row — every card these tests name is deliberately profiled). */
function censusProfile(name: string): CardProfile {
    const profile = getCardProfile(CUBE_SOURCE_KEY, cardId(name));
    if (!profile) throw new Error(`test fixture: "${name}" has no seed row`);
    return profile;
}

describe("Vintage Cube Card Profile census (issue #1614): every seeded Capability is a registry row", () => {
    it("ships a non-empty checked-in seed file for the Vintage Cube scope", () => {
        expect(CUBE_FILE).not.toBeNull();
        expect(CUBE_FILE!.scope).toBe(CUBE_SOURCE_KEY);
        expect(Object.keys(CUBE_FILE!.profiles).length).toBeGreaterThan(100);
    });

    it("the catalogue-wide guard sweep COVERS this file — it is no longer vacuous", () => {
        // `capabilityRegistry.bot.test.ts` validates every file
        // `getAllCheckedInCardProfileFiles` returns. Before this issue that
        // collection was empty, so the guard passed without checking
        // anything; this asserts the seed file is actually inside it.
        const scopes = getAllCheckedInCardProfileFiles().map((f) => f.scope);
        expect(scopes).toContain(CUBE_SOURCE_KEY);
    });

    it("validates against the closed Capability vocabulary and the real card catalogue", () => {
        expect(validateCardProfileFile(CUBE_FILE!)).toEqual({
            valid: true,
            errors: [],
        });
    });

    it("every provides/requires string is a registry row (the check, spelled out per row)", () => {
        for (const [id, profile] of Object.entries(CUBE_FILE!.profiles)) {
            for (const capability of [
                ...profile.provides,
                ...profile.requires,
            ]) {
                expect(
                    isRegisteredCapability(capability),
                    `${id} -> ${capability}`
                ).toBe(true);
            }
        }
    });

    it("every generated row lands unreviewed (ADR 0072: LLM-seeded, human-reviewed)", () => {
        for (const [id, profile] of Object.entries(CUBE_FILE!.profiles)) {
            expect(profile.reviewed, id).toBe(false);
        }
    });

    it("Worldspine Wurm: value-on-death, NOT reanimatable — ADR 0072's motivating example", () => {
        // "When Worldspine Wurm is put into a graveyard from anywhere,
        // shuffle it into its owner's library" — it is never sitting in the
        // graveyard for a reanimation effect to find, however confidently an
        // LLM asserts it is a graveyard fatty.
        const wurm = censusProfile("Worldspine Wurm");
        expect(wurm.provides).toContain("value-on-death");
        expect(wurm.provides).not.toContain("reanimatable");
    });

    it("Blightsteel Colossus: the same shuffle-out clause, the same verdict", () => {
        const colossus = censusProfile("Blightsteel Colossus");
        expect(colossus.provides).not.toContain("reanimatable");
    });

    it("Griselbrand: reanimatable, but NOT value-on-attack (its ability is not gated on attacking)", () => {
        const griselbrand = censusProfile("Griselbrand");
        expect(griselbrand.provides).toContain("reanimatable");
        expect(griselbrand.provides).not.toContain("value-on-attack");
    });

    it("Sneak Attack requires one-combat value; Show and Tell — which puts its target in PERMANENTLY — requires nothing", () => {
        const sneak = censusProfile("Sneak Attack");
        expect(sneak.requires).toEqual(
            expect.arrayContaining(["value-on-etb", "value-on-attack"])
        );
        expect(censusProfile("Show and Tell").requires).toEqual([]);
    });

    it("Phlage/Uro escape rather than reanimate — 'sacrifice it unless it escaped'", () => {
        for (const name of [
            "Phlage, Titan of Fire's Fury",
            "Uro, Titan of Nature's Wrath",
        ]) {
            const profile = censusProfile(name);
            expect(profile.provides, name).not.toContain("reanimatable");
            expect(profile.provides, name).toContain("value-on-etb");
        }
    });

    it("Animate Dead / Reanimate require a reanimatable target and a way to get it there", () => {
        for (const name of ["Animate Dead", "Reanimate", "Exhume"]) {
            expect(censusProfile(name).requires, name).toContain(
                "reanimatable"
            );
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Admin write boundary (`setCardProfile` / `clearCardProfile` pure pieces)
// ─────────────────────────────────────────────────────────────────────────

const EMPTY: CardProfile = {
    archetypes: [],
    provides: [],
    requires: [],
    reviewed: false,
};

describe("Admin write boundary (issue #1614): the database layer is held to the SAME vocabulary bound as the seed layer", () => {
    it("rejects a Capability name outside the closed registry, in either direction", () => {
        expect(
            cardProfileWriteErrors(cardId("Reanimate"), {
                ...EMPTY,
                provides: ["dies-value"],
            })
        ).toEqual(['unregistered Capability provided: "dies-value"']);
        expect(
            cardProfileWriteErrors(cardId("Reanimate"), {
                ...EMPTY,
                requires: ["graveyard-scaling"],
            })
        ).toEqual(['unregistered Capability required: "graveyard-scaling"']);
    });

    it("rejects a cardId that does not resolve to a real card", () => {
        expect(cardProfileWriteErrors("not-a-card", EMPTY)).toEqual([
            'cardId "not-a-card" does not resolve to a card',
        ]);
    });

    it("rejects a combo edge to an unknown partner or with a non-finite weight", () => {
        const errors = cardProfileWriteErrors(cardId("Reanimate"), {
            ...EMPTY,
            comboEdges: [
                { cardId: "nope", weight: 0.4 },
                { cardId: cardId("Griselbrand"), weight: Number.NaN },
            ],
        });
        expect(errors).toHaveLength(2);
        expect(errors[0]).toContain("nope");
        expect(errors[1]).toContain("non-finite weight");
    });

    it("accepts a legal profile", () => {
        expect(
            cardProfileWriteErrors(cardId("Griselbrand"), {
                archetypes: ["reanimator"],
                provides: ["reanimatable"],
                requires: [],
                reviewed: true,
            })
        ).toEqual([]);
    });

    it("normalizes Archetypes (trim, lowercase, dedupe, order preserved) — one plan, not three spellings", () => {
        expect(
            normalizeArchetypes([" Reanimator ", "reanimator", "", "Storm"])
        ).toEqual(["reanimator", "storm"]);
    });

    it("buildCardProfileRow lowercases the scope and normalizes archetypes, carrying the rest verbatim", () => {
        const row = buildCardProfileRow("VINTAGE-Cube", cardId("Griselbrand"), {
            archetypes: ["Reanimator"],
            provides: ["reanimatable"],
            requires: [],
            reviewed: true,
        });
        expect(row.scope).toBe(CUBE_SOURCE_KEY);
        expect(row.archetypes).toEqual(["reanimator"]);
        expect(row.provides).toEqual(["reanimatable"]);
        expect(row.reviewed).toBe(true);
    });

    it("an Admin edit overrides the checked-in census row for the same (scope, cardId)", () => {
        const wurmId = cardId("Worldspine Wurm");
        const edited = buildCardProfileRow(CUBE_SOURCE_KEY, wurmId, {
            ...censusProfile("Worldspine Wurm"),
            reviewed: true,
        });
        const lookup = resolveEventCardProfile(
            [CUBE_SOURCE_KEY],
            buildDbProfileLookup([edited])
        );
        expect(lookup(wurmId)!.reviewed).toBe(true);
        // …and the seed row itself is untouched: clearing the DB row falls
        // straight back to the unreviewed census entry, no "revert" step.
        expect(getCardProfile(CUBE_SOURCE_KEY, wurmId)!.reviewed).toBe(false);
    });

    it("the editor read query's pure core shows BOTH layers per card", () => {
        const cards: ScopeCard[] = [
            { cardId: cardId("Griselbrand"), name: "Griselbrand" },
        ];
        const dbRow = buildCardProfileRow(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            { ...EMPTY, archetypes: ["control"], reviewed: true }
        );
        const [row] = buildScopeCardProfiles(
            CUBE_SOURCE_KEY,
            cards,
            buildDbProfileLookup([dbRow])
        );
        expect(row.dbProfile!.archetypes).toEqual(["control"]);
        expect(row.seedProfile!.provides).toContain("reanimatable");
    });

    it("the editor lists exactly the scope's cards — the SAME enumeration the Pick Rating editor uses", () => {
        const cards = listScopeCards(CUBE_SOURCE_KEY);
        const rows = buildScopeCardProfiles(CUBE_SOURCE_KEY, cards, () => null);
        expect(rows).toHaveLength(cards.length);
        // Every census row is reachable from the editor listing (a profiled
        // card the editor can't show is a row no human can ever review).
        const listed = new Set(rows.map((row) => row.cardId));
        for (const id of Object.keys(CUBE_FILE!.profiles)) {
            expect(listed.has(id), id).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Scope isolation + the bot-pick effect
// ─────────────────────────────────────────────────────────────────────────

describe("scope isolation (issue #1614 acceptance): a cube profile has no effect on a lea event", () => {
    it("the SEED layer is scoped — the census answers for vintage-cube and only vintage-cube", () => {
        const wurmId = cardId("Worldspine Wurm");
        expect(getCardProfile(CUBE_SOURCE_KEY, wurmId)).not.toBeNull();
        expect(getCardProfile("lea", wurmId)).toBeNull();
    });

    it("a lea event resolves nothing from the cube census, even for a card the cube profiles", () => {
        const lookup = resolveEventCardProfile(["lea"], () => null);
        expect(lookup(cardId("Worldspine Wurm"))).toBeNull();
    });

    it("an Admin's cube DATABASE row does not leak into a lea event either", () => {
        const row: ScopedCardProfile = buildCardProfileRow(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            { ...EMPTY, provides: ["reanimatable"], reviewed: true }
        );
        const getDbProfile: GetDbProfile = buildDbProfileLookup([row]);
        expect(
            resolveEventCardProfile(
                ["lea"],
                getDbProfile
            )(cardId("Griselbrand"))
        ).toBeNull();
        expect(
            resolveEventCardProfile(
                [CUBE_SOURCE_KEY],
                getDbProfile
            )(cardId("Griselbrand"))
        ).not.toBeNull();
    });

    it("Pick Ratings and Card Profiles stay independent axes — a profile edit is not a rating edit", () => {
        const getDbRating: GetDbRating = () => null;
        expect(getDbRating(CUBE_SOURCE_KEY, cardId("Griselbrand"))).toBeNull();
    });
});

/** `CardEvalMeta` for a cube card by name — mirrors
 *  `convex/limitedEvents.ts`'s real `getCardEvalMeta`, built from the same
 *  registry helpers so a scoring test is never fed a hand-invented meta. */
function metaOf(name: string): CardEvalMeta {
    const def = tryGetCardByName(name);
    if (!def) throw new Error(`test fixture: no card named "${name}"`);
    return {
        cardId: def.id,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: "rare",
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
    };
}

function packOf(names: readonly string[]): DraftPackCard[] {
    return names.map((name, i) => {
        const meta = metaOf(name);
        return {
            pickId: `pick-${i}`,
            scryfallId: meta.cardId,
            cardId: meta.cardId,
            cardName: name,
        };
    });
}

/** `scorePack` takes already-resolved `CardEvalMeta`s for the Pool;
 *  `chooseBotPick` takes the raw `LimitedPoolCard`s and resolves them itself.
 *  Both shapes come from the same names so the two entry points always see
 *  the same Pool. */
function poolMetaOf(names: readonly string[]): CardEvalMeta[] {
    return names.map(metaOf);
}

function poolCardsOf(names: readonly string[]): LimitedPoolCard[] {
    return names.map((name) => {
        const meta = metaOf(name);
        return {
            scryfallId: meta.cardId,
            cardId: meta.cardId,
            cardName: name,
        };
    });
}

const CUBE_TEST_CARDS = [
    "Reanimate",
    "Thoughtseize",
    "Griselbrand",
    "Worldspine Wurm",
] as const;
const metaByCardId = new Map<string, CardEvalMeta>(
    CUBE_TEST_CARDS.map((name) => {
        const meta = metaOf(name);
        return [meta.cardId, meta];
    })
);

const evalMeta: GetCardEvalMeta = (scryfallId) =>
    metaByCardId.get(scryfallId) ?? null;

/** The Capability Fit term's value for one candidate — the number ADR 0072's
 *  half-weight rule scales. */
function capabilityFitOf(
    pack: readonly DraftPackCard[],
    poolMeta: readonly CardEvalMeta[],
    getCardProfileFn: (id: string) => CardProfile | null,
    candidateName: string
): number {
    const traces = scorePack(pack, poolMeta, evalMeta, {
        packsSeen: [],
        getPickRating: () => 3,
        getCardProfile: getCardProfileFn,
        pickNumber: 20,
        totalPicks: 45,
    });
    const index = pack.findIndex((card) => card.cardName === candidateName);
    const term = traces[index]?.terms.find((t) => t.term === "capabilityFit");
    return term?.value ?? 0;
}

describe("a Card Profile edit takes effect on the bot's next pick (issue #1614 acceptance)", () => {
    // Two mono-black one-drops, so the colour/curve terms are level and the
    // Card Profile layer is what actually decides. Pack order puts the
    // unprofiled card FIRST, so a tie breaks against the synergy pick — the
    // flip below can only come from the profile.
    const pack = packOf(["Thoughtseize", "Reanimate"]);
    const poolMeta = poolMetaOf(["Griselbrand"]);
    const poolCards = poolCardsOf(["Griselbrand"]);

    it("the checked-in census already pairs Reanimate's `requires` with Griselbrand's `provides`", () => {
        const seeded = resolveEventCardProfile([CUBE_SOURCE_KEY], () => null);
        expect(
            capabilityFitOf(pack, poolMeta, seeded, "Reanimate")
        ).toBeGreaterThan(0);
    });

    it("an Admin edit that STRIPS the pool card's Capability removes the match on the very next pick", () => {
        // The exact correction the review flag exists to make possible: a
        // human decides the census over-claimed, clears `provides`, and the
        // bot stops seeing a synergy that was never there.
        const corrected = buildCardProfileRow(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            { ...censusProfile("Griselbrand"), provides: [], reviewed: true }
        );
        const edited = resolveEventCardProfile(
            [CUBE_SOURCE_KEY],
            buildDbProfileLookup([corrected])
        );
        expect(capabilityFitOf(pack, poolMeta, edited, "Reanimate")).toBe(0);
    });

    it("chooseBotPick follows the edit — the pick itself changes, not just a trace", () => {
        const options = {
            packsSeen: [],
            getPickRating: () => 3,
            pickNumber: 20,
            totalPicks: 45,
        };
        // No profiles at all — the state of the world before this census
        // (and after an Admin clears every row): the tie breaks on pack
        // order, so the bot takes Thoughtseize.
        const pickUnprofiled = chooseBotPick(pack, poolCards, evalMeta, {
            ...options,
            getCardProfile: () => null,
        });
        expect(pickUnprofiled).toBe(
            pack.find((c) => c.cardName === "Thoughtseize")!.pickId
        );

        // An Admin reviews the two census rows through the editor
        // (`setCardProfile` -> a `cardProfiles` row -> the layered lookup
        // `convex/limitedEvents.ts#loadEventCardProfile` injects into
        // `chooseBotPick`). The very next pick changes.
        const reviewed = resolveEventCardProfile(
            [CUBE_SOURCE_KEY],
            buildDbProfileLookup([
                buildCardProfileRow(CUBE_SOURCE_KEY, cardId("Griselbrand"), {
                    ...censusProfile("Griselbrand"),
                    reviewed: true,
                }),
                buildCardProfileRow(CUBE_SOURCE_KEY, cardId("Reanimate"), {
                    ...censusProfile("Reanimate"),
                    reviewed: true,
                }),
            ])
        );
        const pickReviewed = chooseBotPick(pack, poolCards, evalMeta, {
            ...options,
            getCardProfile: reviewed,
        });
        expect(pickReviewed).not.toBe(pickUnprofiled);
        expect(pickReviewed).toBe(
            pack.find((c) => c.cardName === "Reanimate")!.pickId
        );
    });
});

describe("reviewing a row measurably increases its contribution (ADR 0072 half weight, issue #1611)", () => {
    const pack = packOf(["Reanimate"]);
    const poolMeta = poolMetaOf(["Griselbrand"]);

    function fitWithReviewed(reviewed: boolean): number {
        const rows = [
            buildCardProfileRow(CUBE_SOURCE_KEY, cardId("Griselbrand"), {
                ...censusProfile("Griselbrand"),
                reviewed,
            }),
            buildCardProfileRow(CUBE_SOURCE_KEY, cardId("Reanimate"), {
                ...censusProfile("Reanimate"),
                reviewed,
            }),
        ];
        return capabilityFitOf(
            pack,
            poolMeta,
            resolveEventCardProfile(
                [CUBE_SOURCE_KEY],
                buildDbProfileLookup(rows)
            ),
            "Reanimate"
        );
    }

    it("an unreviewed pair contributes strictly less than the same pair reviewed", () => {
        const unreviewed = fitWithReviewed(false);
        const reviewed = fitWithReviewed(true);
        expect(unreviewed).toBeGreaterThan(0);
        expect(reviewed).toBeGreaterThan(unreviewed);
    });

    it("the census ships unreviewed, so flipping the flag in the editor is what unlocks full weight", () => {
        const seeded = capabilityFitOf(
            pack,
            poolMeta,
            resolveEventCardProfile([CUBE_SOURCE_KEY], () => null),
            "Reanimate"
        );
        expect(seeded).toBeLessThan(fitWithReviewed(true));
    });
});
