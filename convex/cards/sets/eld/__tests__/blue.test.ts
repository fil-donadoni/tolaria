// Throne of Eldraine (ELD) — blue cards, per-card behavior tests
// (`convex/cards/sets/eld/blue.ts`, ADR 0043 colour split). Each non-trivial
// card gets a describe block citing the CR section it exercises; assertions
// check external behavior only. Shared fixtures live in
// `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import { emryLurkerOfTheLoch } from "..";
import { solRing } from "../../lea";
import { getCardByName } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    getLegalActions,
    getLegalTargets,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";

// ─────────────────────────────────────────────────────────────────────────────
// Slice #1337 (PRD #702, ADR 0063) — count-driven SELF-HOST cost reduction:
// Emry, Lurker of the Loch, "This spell costs {1} less to cast for each
// artifact you control." Unlike every other `costReduction` consumer (Mana
// Matrix, Planar Gate, Power Artifact, Stone Calendar — all discovered via a
// battlefield `staticEffects` scan and asserted unchanged by their OWN
// existing test suites, run as this change's regression), Emry's reducer is
// intrinsic to the spell being cast and is read directly off her own
// `CardDefinition.selfCostReduction` at the same CR 601.2f apply site
// (`getCostModifiers`, `gre/state.ts`). Generic-only, floored at 0, evaluated
// against the ANNOUNCING player's own battlefield.
// ─────────────────────────────────────────────────────────────────────────────

describe("Emry, Lurker of the Loch (count-driven self cost-reduction, CR 601.2f / ADR 0063)", () => {
    /** Mirror game.ts's plain hand-cast cost calc: normalize the printed cost,
     *  then fold in cost modifiers (battlefield scan + self-host) — the exact
     *  functions game.ts calls at the real cast site (`convex/game.ts:4685`). */
    function effectiveCastCost(
        state: GameState,
        controllerId = "p1"
    ): Record<string, number> {
        const spellView = makeInstance(emryLurkerOfTheLoch.id, {
            id: "emry-spell-view",
            controllerId,
            zone: "hand",
        });
        const cost = normalizeManaCost(emryLurkerOfTheLoch.manaCost ?? {});
        applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
        return cost;
    }

    function boardWithArtifacts(n: number, controllerId: "p1" | "p2" = "p1") {
        const artifacts = Array.from({ length: n }, (_, i) =>
            makeInstance(solRing.id, { id: `art-${i}`, controllerId })
        );
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: controllerId === "p1" ? artifacts : [],
                }),
                makePlayer("p2", {
                    battlefield: controllerId === "p2" ? artifacts : [],
                }),
            ],
        });
    }

    it("costs the full {2}{U} with no artifacts controlled", () => {
        expect(effectiveCastCost(boardWithArtifacts(0))).toEqual({
            X: 2,
            U: 1,
        });
    });

    it("costs {1} less per artifact you control (1 artifact → {1}{U})", () => {
        expect(effectiveCastCost(boardWithArtifacts(1))).toEqual({
            X: 1,
            U: 1,
        });
    });

    it("drops the generic portion entirely at 2 artifacts (2 × {1} = the full {2})", () => {
        expect(effectiveCastCost(boardWithArtifacts(2))).toEqual({ U: 1 });
    });

    it("floors at 0 generic — never goes negative (5 artifacts, only {2} generic to reduce)", () => {
        expect(effectiveCastCost(boardWithArtifacts(5))).toEqual({ U: 1 });
    });

    it("never reduces the colored {U} pip (CR 601.2f generic-only)", () => {
        expect(effectiveCastCost(boardWithArtifacts(5)).U).toBe(1);
    });

    it("only counts the CASTER's own artifacts, never an opponent's", () => {
        // The 3 artifacts belong to p2; p1 is casting Emry.
        expect(effectiveCastCost(boardWithArtifacts(3, "p2"), "p1")).toEqual({
            X: 2,
            U: 1,
        });
    });

    it("does not count herself (a Creature is never an Artifact, and she isn't a permanent while being cast)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(emryLurkerOfTheLoch.id, {
                            id: "other-emry",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(effectiveCastCost(state)).toEqual({ X: 2, U: 1 });
    });

    it("castability (server legalActions) is NOT offered without enough mana or artifacts", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(emryLurkerOfTheLoch.id, {
                            id: "emry-hand",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const card = state.players[0].hand[0];
        // Only {U} floating — the un-reduced {2}{U} isn't payable.
        expect(getLegalActions(state, state.players[0], card)).not.toContain(
            "cast"
        );
    });

    it("castability (server legalActions) reflects the reduction once enough artifacts are controlled", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(emryLurkerOfTheLoch.id, {
                            id: "emry-hand",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(solRing.id, {
                            id: "art-1",
                            controllerId: "p1",
                        }),
                        makeInstance(solRing.id, {
                            id: "art-2",
                            controllerId: "p1",
                        }),
                    ],
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const card = state.players[0].hand[0];
        // {2} generic fully reduced by 2 artifacts → {U} only, payable with
        // the {U} floating in the pool.
        expect(getLegalActions(state, state.players[0], card)).toContain(
            "cast"
        );
    });

    it("the castability flip survives the wire projection (GRE → UI full path)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(emryLurkerOfTheLoch.id, {
                            id: "emry-hand",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(solRing.id, {
                            id: "art-1",
                            controllerId: "p1",
                        }),
                        makeInstance(solRing.id, {
                            id: "art-2",
                            controllerId: "p1",
                        }),
                    ],
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedEmry = projected.players[0].hand.find(
            (c) => c?.id === "emry-hand"
        )!;
        expect(projectedEmry.legalActions).toContain("cast");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1650 (parent PRD #702) — Emry's `{T}` ability: "Choose target artifact
// card in your graveyard. You may cast that card this turn. (You still pay its
// costs. Timing rules still apply.)"
//
// NO new primitive and NO new `TargetRequirement.type`: the target is the
// already-shipped graveyard-zone requirement shape (CR 601.2c / 400.7 —
// `zone: "graveyard"` + `controller: "you"`, as Regrowth/Necropolis use) and
// the effect is the already-shipped `grantCastFromGraveyard` Op (issue #1344),
// whose `card` selector was widened from a bare picks ref to the full
// `EffectObjectSelector` so an announced target slot names the card directly.
// ─────────────────────────────────────────────────────────────────────────────

/** Push an activated ability on the stack (costs assumed paid) and resolve —
 *  the same shim the DRK/INV colour suites use (`sets/drk/__tests__/helpers`). */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

const EMRY_GRANT_ABILITY = "emry-lurker-of-the-loch-graveyard-cast";

/** Emry on the battlefield + `graveyard` in p1's graveyard. */
function emryBoard(graveyard: CardInstanceState[]) {
    const emry = makeInstance(emryLurkerOfTheLoch.id, {
        id: "emry",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [emry], graveyard }),
            makePlayer("p2"),
        ],
    });
    return { state, emry: state.players[0].battlefield[0] };
}

function gyCard(
    cardId: string,
    id: string,
    ownerId: "p1" | "p2" = "p1"
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
    });
}

describe("Emry, Lurker of the Loch — {T}: graveyard artifact cast permission (CR 601.2c / 601.3e, issue #1650)", () => {
    it("only artifact cards in the activator's OWN graveyard are legal targets (CR 601.2c)", () => {
        const { state } = emryBoard([
            gyCard(solRing.id, "gy-artifact"),
            gyCard(getCardByName("Grizzly Bears").id, "gy-creature"),
        ]);
        // An artifact in the OPPONENT's graveyard must not qualify.
        state.players[1].graveyard.push(
            gyCard(solRing.id, "their-artifact", "p2")
        );
        const ability = emryLurkerOfTheLoch.activatedAbilities!.find(
            (a) => a.id === EMRY_GRANT_ABILITY
        )!;
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(legal).toEqual([
            { type: "graveyard-card", id: "gy-artifact", playerId: "p1" },
        ]);
    });

    it("resolution stamps a THIS-TURN cast permission on the targeted card, cost still payable (CR 601.3e)", () => {
        const { state, emry } = emryBoard([gyCard(solRing.id, "gy-artifact")]);
        resolveActivated(state, emry, EMRY_GRANT_ABILITY, [
            { type: "graveyard-card", id: "gy-artifact", playerId: "p1" },
        ]);
        const granted = state.players[0].graveyard.find(
            (c) => c.id === "gy-artifact"
        )!;
        expect(granted.castableFromGraveyardBy).toBe("p1");
        // "this-turn" impulse window — revoked at CLEANUP.
        expect(granted.castableFromGraveyardUntilTurn).toBe(state.turn);
        // "You still pay its costs" — no mana-cost waiver rides the grant.
        expect(granted.castFromGraveyardWithoutPayingManaCost).toBeUndefined();
    });

    it("the granted card becomes castable from the graveyard (server legalActions)", () => {
        const { state, emry } = emryBoard([gyCard(solRing.id, "gy-artifact")]);
        const before = getLegalActions(
            state,
            state.players[0],
            state.players[0].graveyard[0]
        );
        expect(before).not.toContain("cast");

        resolveActivated(state, emry, EMRY_GRANT_ABILITY, [
            { type: "graveyard-card", id: "gy-artifact", playerId: "p1" },
        ]);
        // Sol Ring is {1}: fund it so the affordability gate passes.
        state.players[0].manaPool = {
            W: 0,
            U: 0,
            B: 0,
            R: 0,
            G: 0,
            C: 1,
        };
        expect(
            getLegalActions(
                state,
                state.players[0],
                state.players[0].graveyard[0]
            )
        ).toContain("cast");
    });

    it("the permission is NOT a free cast — an unfunded pool leaves it uncastable (CR 601.2f)", () => {
        const { state, emry } = emryBoard([gyCard(solRing.id, "gy-artifact")]);
        resolveActivated(state, emry, EMRY_GRANT_ABILITY, [
            { type: "graveyard-card", id: "gy-artifact", playerId: "p1" },
        ]);
        // Empty pool, no lands — {1} is unpayable, so the grant alone does not
        // make the card castable (contrast Malcolm's free-cast grant).
        expect(
            getLegalActions(
                state,
                state.players[0],
                state.players[0].graveyard[0]
            )
        ).not.toContain("cast");
    });

    it("CR 608.2b — a target that left the graveyard before resolution grants nothing", () => {
        const { state, emry } = emryBoard([gyCard(solRing.id, "gy-artifact")]);
        const gone = state.players[0].graveyard.pop()!;
        state.players[0].exile.push({ ...gone, zone: "exile" });
        resolveActivated(state, emry, EMRY_GRANT_ABILITY, [
            { type: "graveyard-card", id: "gy-artifact", playerId: "p1" },
        ]);
        expect(
            state.players[0].exile[0].castableFromGraveyardBy
        ).toBeUndefined();
    });

    it("wire format — the granted card reaches the client as a castable graveyard-grant", () => {
        const { state, emry } = emryBoard([gyCard(solRing.id, "gy-artifact")]);
        resolveActivated(state, emry, EMRY_GRANT_ABILITY, [
            { type: "graveyard-card", id: "gy-artifact", playerId: "p1" },
        ]);
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].graveyard.find(
            (c) => c.id === "gy-artifact"
        )!;
        // The raw grant fields are server-side; the client sees the derived
        // `castKind` + `legalActions` the Cast affordance reads.
        expect(slim.castKind).toBe("graveyard-grant");
        expect(slim.legalActions).toContain("cast");
    });

    it("wire format — an UNgranted graveyard artifact carries no cast affordance", () => {
        const { state } = emryBoard([gyCard(solRing.id, "gy-artifact")]);
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].graveyard.find(
            (c) => c.id === "gy-artifact"
        )!;
        expect(slim.castKind).toBeUndefined();
        expect(slim.legalActions ?? []).not.toContain("cast");
    });
});
