import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards/index";
import {
    tryAutoCommitPendingCast,
    recordCastAlternativeHandCostPick,
} from "../../game";
import {
    alternativeCostConditionMet,
    canPayAlternativeCost,
    canPayHandCost,
    buildAlternativeCostHandChoice,
    validateAlternativeHandCostPicks,
    getAlternativeCost,
    matchingHandCardsForAltCost,
} from "../alternativeCost";
import { projectPublicState } from "../../gameProjections";
import type { GameState, CardInstanceState } from "../state";

// CR 118.9 — the alternative pitch-cost framework: a spell cast by giving up a
// non-mana resource (life, a card from hand, a permanent) instead of paying its
// mana cost. Built once here, reused by every pitch card (Force of Will, Foil,
// Snuff Out, Daze, …). See convex/gre/alternativeCost.ts.

const island = getCardByName("Island");
const counterspell = getCardByName("Counterspell"); // {U}{U} — a blue card
const lightningBolt = getCardByName("Lightning Bolt"); // {R} — a red card
const forceOfWill = getCardByName("Force of Will");
const foil = getCardByName("Foil");
const snuffOut = getCardByName("Snuff Out");

function handCard(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
}

describe("alternativeCostConditionMet (CR 118.9)", () => {
    const base = () =>
        makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });

    it("your-turn holds on the caster's own turn, not otherwise", () => {
        const state = base();
        expect(
            alternativeCostConditionMet(state, "p1", { kind: "your-turn" })
        ).toBe(true);
        expect(
            alternativeCostConditionMet(state, "p2", { kind: "your-turn" })
        ).toBe(false);
    });

    it("not-your-turn is the negation", () => {
        const state = base();
        expect(
            alternativeCostConditionMet(state, "p1", { kind: "not-your-turn" })
        ).toBe(false);
        expect(
            alternativeCostConditionMet(state, "p2", { kind: "not-your-turn" })
        ).toBe(true);
    });

    it("control <filter> holds only while a matching permanent is controlled", () => {
        const swampId = getCardByName("Swamp").id;
        const withSwamp = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(swampId, {
                            id: "sw1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        const cond = {
            kind: "control" as const,
            filter: { subtypes: "Swamp" },
        };
        expect(alternativeCostConditionMet(withSwamp, "p1", cond)).toBe(true);
        expect(alternativeCostConditionMet(base(), "p1", cond)).toBe(false);
    });

    it("an absent condition is always met", () => {
        expect(alternativeCostConditionMet(base(), "p1", undefined)).toBe(true);
    });

    // Issue #790 (Once Upon a Time) — "If this spell is the first spell
    // you've cast this game, you may cast it without paying its mana cost."
    describe("first-spell-this-game (issue #790)", () => {
        const cond = { kind: "first-spell-this-game" as const };

        it("holds when the caster has cast no spells this game", () => {
            const state = base();
            expect(alternativeCostConditionMet(state, "p1", cond)).toBe(true);
        });

        it("fails once the caster has cast a spell, this turn or a prior one", () => {
            const state = base();
            state.players[0].spellsCastThisGame = 1;
            expect(alternativeCostConditionMet(state, "p1", cond)).toBe(false);
        });

        it("is scoped to the CASTER, not the table — the opponent's casts don't consume it", () => {
            const state = base();
            state.players[1].spellsCastThisGame = 5;
            expect(alternativeCostConditionMet(state, "p1", cond)).toBe(true);
        });

        it("is NOT reset by a turn change, unlike spellsCastThisTurn", () => {
            const state = base();
            // A spell cast on a prior turn: spellsCastThisTurn resets every
            // turn, but the lifetime tally does not.
            state.players[0].spellsCastThisTurn = 0;
            state.players[0].spellsCastThisGame = 1;
            expect(alternativeCostConditionMet(state, "p1", cond)).toBe(false);
        });
    });
});

describe("canPayAlternativeCost — life & hand legs (CR 119.4 / 118.9)", () => {
    it("life leg is affordable only with life >= amount (CR 119.4)", () => {
        const altCost = getAlternativeCost(snuffOut, "pitch-pay-4-life")!;
        const swampId = getCardByName("Swamp").id;
        const withSwamp = (life: number) =>
            makeState({
                players: [
                    makePlayer("p1", {
                        life,
                        battlefield: [
                            makeInstance(swampId, {
                                id: "sw1",
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "battlefield",
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
            });
        expect(canPayAlternativeCost(withSwamp(4), "p1", altCost)).toBe(true);
        expect(canPayAlternativeCost(withSwamp(3), "p1", altCost)).toBe(false);
    });

    it("Snuff Out's control-a-Swamp condition gates the life leg", () => {
        const altCost = getAlternativeCost(snuffOut, "pitch-pay-4-life")!;
        const noSwamp = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
            activePlayerId: "p1",
        });
        expect(canPayAlternativeCost(noSwamp, "p1", altCost)).toBe(false);
    });

    it("hand leg is affordable only with a matching hand card (CR 118.9)", () => {
        const altCost = getAlternativeCost(
            forceOfWill,
            "pitch-pay-1-life-exile-blue"
        )!;
        const fowInst = handCard(forceOfWill.id, "fow");
        const blueInst = handCard(counterspell.id, "blue");
        const withBlue = makeState({
            players: [
                makePlayer("p1", { life: 20, hand: [fowInst, blueInst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
        });
        const withoutBlue = makeState({
            players: [
                makePlayer("p1", { life: 20, hand: [fowInst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
        });
        // The card can't pay for its own cost (CR 118.9) — excluded by id.
        expect(canPayAlternativeCost(withBlue, "p1", altCost, "fow")).toBe(
            true
        );
        expect(canPayAlternativeCost(withoutBlue, "p1", altCost, "fow")).toBe(
            false
        );
    });

    it("canPayHandCost requires DISTINCT cards per requirement (Foil)", () => {
        const altCost = getAlternativeCost(
            foil,
            "pitch-discard-island-and-card"
        )!;
        const foilInst = handCard(foil.id, "foil");
        const islandInst = handCard(island.id, "isl");
        const other = handCard(lightningBolt.id, "bolt");
        // Island + another distinct card → payable.
        const ok = makePlayer("p1", { hand: [foilInst, islandInst, other] });
        expect(canPayHandCost(ok, altCost, "foil")).toBe(true);
        // Only the Island (besides Foil): can't also cover "another card".
        const short = makePlayer("p1", { hand: [foilInst, islandInst] });
        expect(canPayHandCost(short, altCost, "foil")).toBe(false);
    });

    // `EffectCardFilter.any` (issue #897) — OR ACROSS filter dimensions, the
    // same disjunctive clause the effect-script interpreter honors
    // (`matchesCardFilter`). `handCardMatchesFilter` is a SEPARATE copy of
    // that matcher scoped to the hand leg's `CardDefinition` shape, and it
    // dropped `any` on the floor — a filter carrying ONLY `any` mapped to an
    // all-undefined set of checks and fell straight through to `return true`,
    // matching every hand card (fail OPEN) instead of just the disjunction
    // members. Proves the fix: a Land (matches `type`), a red Instant
    // (matches `color`), and a blue Instant (matches NEITHER clause) — only
    // the first two should be eligible.
    it("matchingHandCardsForAltCost honors a disjunctive `any` clause (type OR color, issue #897)", () => {
        const foilInst = handCard(foil.id, "foil");
        const islandInst = handCard(island.id, "isl");
        const boltInst = handCard(lightningBolt.id, "bolt");
        const counterspellInst = handCard(counterspell.id, "ctr");
        const player = makePlayer("p1", {
            hand: [foilInst, islandInst, boltInst, counterspellInst],
        });
        const matches = matchingHandCardsForAltCost(
            player,
            { any: [{ type: "Land" }, { color: "R" }] },
            "foil"
        );
        expect(matches.map((c) => c.id).sort()).toEqual(["bolt", "isl"]);
    });

    // `EffectCardFilter.manaCostEquals` (issue #1881 / #1898 finding 2, PR
    // #1898 second fixup round) — the hand-leg sibling of
    // `matchesCardFilter`'s own `manaCostEquals` branch. Before the fix,
    // `handCardMatchesFilter` had no `manaCostEquals` case, so a
    // `discardFilter`/hand-leg filter carrying it fell straight through to
    // `return true` — matching EVERY hand card (fail OPEN), the identical
    // shape issue #1898 fixed for `matchesCardFilter`. Ornithopter ({0}
    // Artifact) is the only hand card whose printed cost structurally equals
    // `{}`. Two lands prove the carve-out is real and not incidental: the
    // Island (no `manaCost` field at all — a bare `def.manaCost` read would
    // also be `undefined` there, so it proves nothing) must NOT match, and
    // Mishra's Factory (a Land that DOES carry a printed `manaCost: {}`,
    // `atq/colorless.ts`) must ALSO not match — only that second card
    // actually exercises `manaCostForCardFilter`'s Land carve-out rather than
    // an early `undefined` exit. Lightning Bolt ({R}) / Counterspell ({U}{U})
    // must not match either.
    it("matchingHandCardsForAltCost honors manaCostEquals — excludes non-{0} cards AND Lands (issue #1881/#1898)", () => {
        const ornithopter = getCardByName("Ornithopter");
        const ornithopterInst = handCard(ornithopter.id, "orn");
        const islandInst = handCard(island.id, "isl");
        const mishrasFactory = getCardByName("Mishra's Factory");
        const mishrasFactoryInst = handCard(mishrasFactory.id, "fac");
        const boltInst = handCard(lightningBolt.id, "bolt");
        const counterspellInst = handCard(counterspell.id, "ctr");
        const player = makePlayer("p1", {
            hand: [
                ornithopterInst,
                islandInst,
                mishrasFactoryInst,
                boltInst,
                counterspellInst,
            ],
        });
        const matches = matchingHandCardsForAltCost(
            player,
            { manaCostEquals: [{}] },
            "foil"
        );
        expect(matches.map((c) => c.id)).toEqual(["orn"]);
    });
});

describe("buildAlternativeCostHandChoice — auto-resolve vs park (CR 118.9 / 601.2h)", () => {
    const altCost = getAlternativeCost(
        forceOfWill,
        "pitch-pay-1-life-exile-blue"
    )!;

    it("auto-resolves the forced case (exactly one matching card)", () => {
        const player = makePlayer("p1", {
            hand: [
                handCard(forceOfWill.id, "fow"),
                handCard(counterspell.id, "b1"),
            ],
        });
        const choice = buildAlternativeCostHandChoice(player, altCost, "fow")!;
        expect(choice.pickedCardIds).toEqual(["b1"]);
    });

    it("parks (no auto-pick) when more than one card qualifies", () => {
        const player = makePlayer("p1", {
            hand: [
                handCard(forceOfWill.id, "fow"),
                handCard(counterspell.id, "b1"),
                handCard(counterspell.id, "b2"),
            ],
        });
        const choice = buildAlternativeCostHandChoice(player, altCost, "fow")!;
        expect(choice.pickedCardIds).toBeUndefined();
        expect(choice.action).toBe("exile");
    });
});

describe("validateAlternativeHandCostPicks (CR 118.9)", () => {
    const altCost = getAlternativeCost(foil, "pitch-discard-island-and-card")!;
    const choice = {
        requirements: altCost.hand!.requirements,
        excludeInstanceId: "foil",
    };
    const player = () =>
        makePlayer("p1", {
            hand: [
                handCard(foil.id, "foil"),
                handCard(island.id, "isl"),
                handCard(lightningBolt.id, "bolt"),
            ],
        });

    it("accepts an Island + another distinct card", () => {
        expect(() =>
            validateAlternativeHandCostPicks(player(), choice, ["isl", "bolt"])
        ).not.toThrow();
    });

    it("rejects the wrong count", () => {
        expect(() =>
            validateAlternativeHandCostPicks(player(), choice, ["isl"])
        ).toThrow();
    });

    it("rejects the cast card itself", () => {
        expect(() =>
            validateAlternativeHandCostPicks(player(), choice, ["foil", "isl"])
        ).toThrow();
    });

    it("rejects picks that don't cover the Island requirement", () => {
        const noIsland = makePlayer("p1", {
            hand: [
                handCard(foil.id, "foil"),
                handCard(lightningBolt.id, "bolt"),
                handCard(counterspell.id, "cs"),
            ],
        });
        expect(() =>
            validateAlternativeHandCostPicks(noIsland, choice, ["bolt", "cs"])
        ).toThrow();
    });
});

// End-to-end (GRE → commit): a parked pitch cast whose hand leg the player has
// picked commits through tryAutoCommitPendingCast, paying life + moving the
// picked cards hand → exile / graveyard and pushing the spell on the stack.
describe("pitch cast commit pays the hand + life legs (CR 118.9 / 601.2h)", () => {
    function forceOfWillCast(): GameState {
        const fowInst = handCard(forceOfWill.id, "fow");
        const b1 = handCard(counterspell.id, "b1");
        const b2 = handCard(counterspell.id, "b2");
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, hand: [fowInst, b1, b2] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        // A spell on the stack for Force of Will to counter.
        const boltOnStack = pushSpell(state, lightningBolt.id, "p2");
        boltOnStack.id = "bolt";
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "fow",
            manaCost: {},
            tappedLandIds: [],
            payLife: 1,
            alternativeCostHandChoice: {
                action: "exile",
                requirements: [{ filter: { color: "U" }, count: 1 }],
                excludeInstanceId: "fow",
            },
        };
        (state.pendingCast as Record<string, unknown>).targets = [
            { type: "spell", id: "bolt" },
        ];
        return state;
    }

    it("blocks commit until the hand leg is picked", () => {
        const state = forceOfWillCast();
        expect(tryAutoCommitPendingCast(state, "p1")).toBeNull();
        // Force of Will still in hand; nothing exiled.
        expect(state.players[0].hand.map((c) => c.id)).toContain("fow");
        expect(state.players[0].exile).toHaveLength(0);
    });

    it("commits after the pick: exiles the blue card, pays 1 life, stacks the spell", () => {
        const state = forceOfWillCast();
        recordCastAlternativeHandCostPick(state, "p1", ["b1"]);
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).not.toBeNull();
        const p1 = state.players[0];
        // The chosen blue card was exiled; the other stayed in hand.
        expect(p1.exile.map((c) => c.id)).toEqual(["b1"]);
        expect(p1.hand.map((c) => c.id)).toContain("b2");
        expect(p1.hand.map((c) => c.id)).not.toContain("fow");
        // 1 life paid (CR 119.4).
        expect(p1.life).toBe(19);
        // Force of Will on the stack, above the bolt it targets.
        expect(state.stack.some((s) => s.id === "fow")).toBe(true);
    });

    it("Foil's discard leg moves the picked cards to the graveyard", () => {
        const foilInst = handCard(foil.id, "foil");
        const islandInst = handCard(island.id, "isl");
        const bolt = handCard(lightningBolt.id, "bolt");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [foilInst, islandInst, bolt] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        const spellOnStack = pushSpell(state, counterspell.id, "p2");
        spellOnStack.id = "cs";
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "foil",
            manaCost: {},
            tappedLandIds: [],
            alternativeCostHandChoice: {
                action: "discard",
                requirements: [
                    { filter: { subtype: "Island" }, count: 1 },
                    { filter: {}, count: 1 },
                ],
                excludeInstanceId: "foil",
            },
        };
        (state.pendingCast as Record<string, unknown>).targets = [
            { type: "spell", id: "cs" },
        ];
        recordCastAlternativeHandCostPick(state, "p1", ["isl", "bolt"]);
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        const p1 = state.players[0];
        // Both cost cards discarded to the graveyard (CR 701.9).
        expect(p1.graveyard.map((c) => c.id).sort()).toEqual(["bolt", "isl"]);
        expect(state.stack.some((s) => s.id === "foil")).toBe(true);
    });
});

// Frontend wiring (mandatory): the hand-leg picker rides on pendingCast, which
// the client reads to render the card picker. It must survive the wire
// projection or the dialog never appears (a dead card).
describe("pendingCast.alternativeCostHandChoice survives projectPublicState", () => {
    it("carries the requirements + action to the caster's client view", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCard(forceOfWill.id, "fow")],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        const choice = {
            action: "exile" as const,
            requirements: [{ filter: { color: "U" as const }, count: 1 }],
            excludeInstanceId: "fow",
        };
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "fow",
            manaCost: {},
            tappedLandIds: [],
            alternativeCostHandChoice: choice,
        };
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingCast?.alternativeCostHandChoice).toEqual(
            choice
        );
    });
});
