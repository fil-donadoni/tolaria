// Saddle N (CR 702.171) + Caustic Bronco, its first Mount.
//
// Full-path coverage: announcement and the tap-other picker through the REAL
// game.ts entry points (`activateAbilityOnState`, `selectActivationCostOnState`),
// resolution via `resolveTopOfStack`, the CR 514.2 cleanup clear, the CR 400.7
// zone-change clear, the attack trigger through `finalizeConfirmAttackers`
// (the `confirmAttackers` mutation's own finalize), the CR 608.2h
// last-known-information read, and the wire-format projection.

import { describe, it, expect } from "vitest";
import type { GameState } from "../state";
import { removePermanentTo, resolveTopOfStack } from "../state";
import { finalizeCleanup } from "../phases";
import {
    activateAbilityOnState,
    finalizeConfirmAttackers,
    selectActivationCostOnState,
} from "../../game";
import { projectPublicState } from "../../gameProjections";
import { grizzlyBears, savannahLions } from "../../cards/sets/lea/index.cards";
import { causticBronco } from "../../cards/sets/otj/index.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { refreshExpectedInput } from "../expectedInput";
import {
    validateAbilityEffectScript,
    validateEffectScript,
} from "../effects/validate";
import type {
    CardDefinition,
    EffectObjectMatchesFilterPredicate,
    EffectOp,
} from "../../cards/types";
import { withTemporaryDefinition } from "../../cards/registry";

const SADDLE_ABILITY_ID = "caustic-bronco-saddle";
const BRONCO_TRIGGER_ID = "caustic-bronco-attacks";

/** Bronco + the requested creatures under p1; `library` seeds p1's library
 *  (top first). Precombat main, p1 active with priority. */
function broncoBoard(
    creatures: ReadonlyArray<{
        id: string;
        cardId: string;
        tapped?: boolean;
        sick?: boolean;
    }>,
    opts: { library?: readonly string[] } = {}
): GameState {
    const bronco = makeInstance(causticBronco().id, {
        id: "bronco",
        controllerId: "p1",
        ownerId: "p1",
    });
    const perms = creatures.map((c) =>
        makeInstance(c.cardId, {
            id: c.id,
            controllerId: "p1",
            ownerId: "p1",
            isTapped: c.tapped === true,
            isSummoningSick: c.sick === true,
        })
    );
    const library = (opts.library ?? []).map((cardId, i) =>
        makeInstance(cardId, {
            id: `lib-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [bronco, ...perms], library }),
            makePlayer("p2"),
        ],
    });
}

function broncoOf(state: GameState) {
    return state.players[0].battlefield.find((c) => c.id === "bronco");
}

/** Announce Saddle, then feed the picker one creature at a time — both steps
 *  the REAL game.ts code. */
function saddleWith(state: GameState, pickIds: readonly string[]): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "bronco",
        abilityId: SADDLE_ABILITY_ID,
    });
    for (const id of pickIds) {
        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: id,
        });
    }
}

/** Saddle with `pickIds`, resolve it, and hand priority back to p1. */
function saddleAndResolve(state: GameState, pickIds: readonly string[]) {
    saddleWith(state, pickIds);
    resolveTopOfStack(state);
    state.priorityPlayerId = "p1";
    state.passCount = 0;
    refreshExpectedInput(state);
}

/** Declares Bronco as the sole attacker through the `confirmAttackers`
 *  mutation's finalize, which collects and stacks the attack trigger. */
function attackWithBronco(state: GameState): void {
    state.phase = "DECLARE_ATTACKERS";
    state.activePlayerId = "p1";
    state.priorityPlayerId = "p1";
    state.combat = {
        attackerIds: ["bronco"],
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    finalizeConfirmAttackers(state);
}

function life(state: GameState, playerId: string): number {
    return state.players.find((p) => p.id === playerId)!.life;
}

function broncoTriggers(state: GameState) {
    return state.stack.filter(
        (s) => s.triggeredAbilityId === BRONCO_TRIGGER_ID
    );
}

// ===========================================================================
describe("Saddle N (CR 702.171a)", () => {
    it("taps other creatures with total power ≥ N and the Mount becomes saddled on resolution", () => {
        // Two 2/2s: Saddle 3 needs both (2 < 3, 4 ≥ 3).
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id },
            { id: "bear-b", cardId: grizzlyBears().id },
        ]);
        saddleWith(state, ["bear-a"]);
        // One 2/2 is short of 3: the picker stays open.
        expect(state.pendingActivation).toBeDefined();
        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: "bear-b",
        });
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        const tapped = state.players[0].battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();
        expect(tapped).toEqual(["bear-a", "bear-b"]);
        // Saddle has no {T} on the Mount itself.
        expect(broncoOf(state)!.isTapped).toBe(false);
        // CR 608.2 — not saddled until the ability resolves.
        expect(broncoOf(state)!.saddled).toBeUndefined();

        resolveTopOfStack(state);
        expect(broncoOf(state)!.saddled).toBe(true);
    });

    it("total power below N cannot be announced (CR 601.2h — unpayable costs can't be paid)", () => {
        const state = broncoBoard([{ id: "lion", cardId: savannahLions().id }]);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "bronco",
                abilityId: SADDLE_ABILITY_ID,
            })
        ).toThrow(/Not enough untapped permanents/);
        expect(state.players[0].battlefield.every((c) => !c.isTapped)).toBe(
            true
        );
    });

    it("tapped creatures are not candidates ('other untapped creatures')", () => {
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id },
            { id: "bear-b", cardId: grizzlyBears().id, tapped: true },
        ]);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "bronco",
                abilityId: SADDLE_ABILITY_ID,
            })
        ).toThrow(/Not enough untapped permanents/);
    });

    it("the Mount itself is never a legal pick ('other')", () => {
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id },
            { id: "bear-b", cardId: grizzlyBears().id },
        ]);
        saddleWith(state, []);
        expect(() =>
            selectActivationCostOnState(state, {
                playerId: "p1",
                cardInstanceId: "bronco",
            })
        ).toThrow();
        expect(broncoOf(state)!.isTapped).toBe(false);
    });

    it("SUMMONING-SICK creatures can saddle (CR 302.6 governs a creature's own {T} only)", () => {
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id, sick: true },
            { id: "bear-b", cardId: grizzlyBears().id, sick: true },
        ]);
        saddleAndResolve(state, ["bear-a", "bear-b"]);
        expect(broncoOf(state)!.saddled).toBe(true);
    });

    it("'Activate only as a sorcery' — rejected outside a main phase", () => {
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id },
            { id: "bear-b", cardId: grizzlyBears().id },
        ]);
        state.phase = "UPKEEP";
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "bronco",
                abilityId: SADDLE_ABILITY_ID,
            })
        ).toThrow(/Activate only as a sorcery/);
    });

    it("'Activate only as a sorcery' — rejected while the stack is not empty", () => {
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id },
            { id: "bear-b", cardId: grizzlyBears().id },
            { id: "bear-c", cardId: grizzlyBears().id },
            { id: "bear-d", cardId: grizzlyBears().id },
        ]);
        saddleWith(state, ["bear-a", "bear-b"]);
        expect(state.stack).toHaveLength(1);
        state.priorityPlayerId = "p1";
        state.passCount = 0;
        refreshExpectedInput(state);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "bronco",
                abilityId: SADDLE_ABILITY_ID,
            })
        ).toThrow(/Activate only as a sorcery/);
    });

    it("saddling an already-saddled Mount is a legal no-op", () => {
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id },
            { id: "bear-b", cardId: grizzlyBears().id },
            { id: "bear-c", cardId: grizzlyBears().id },
            { id: "bear-d", cardId: grizzlyBears().id },
        ]);
        saddleAndResolve(state, ["bear-a", "bear-b"]);
        saddleAndResolve(state, ["bear-c", "bear-d"]);
        expect(broncoOf(state)!.saddled).toBe(true);
        expect(state.stack).toHaveLength(0);
    });
});

// ===========================================================================
describe("the saddled designation (CR 702.171b)", () => {
    it("stays until the end of the turn — cleared at cleanup (CR 514.2)", () => {
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id },
            { id: "bear-b", cardId: grizzlyBears().id },
        ]);
        saddleAndResolve(state, ["bear-a", "bear-b"]);
        expect(broncoOf(state)!.saddled).toBe(true);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(broncoOf(state)!.saddled).toBeUndefined();
    });

    it("ends when the permanent leaves the battlefield and does not come back with it (CR 400.7)", () => {
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id },
            { id: "bear-b", cardId: grizzlyBears().id },
        ]);
        saddleAndResolve(state, ["bear-a", "bear-b"]);
        removePermanentTo(state, "bronco", "hand");
        const inHand = state.players[0].hand.find((c) => c.id === "bronco")!;
        expect(inHand.saddled).toBeUndefined();
    });

    it("crosses the wire through projectPublicState", () => {
        const state = broncoBoard([
            { id: "bear-a", cardId: grizzlyBears().id },
            { id: "bear-b", cardId: grizzlyBears().id },
        ]);
        const before = projectPublicState(state, 1, "p2");
        expect(
            before.players[0].battlefield.find((c) => c.id === "bronco")!
                .saddled
        ).toBeUndefined();
        saddleAndResolve(state, ["bear-a", "bear-b"]);
        // The OPPONENT's view: a saddled Mount looks different to both seats.
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bronco"
        )!;
        expect(slim.saddled).toBe(true);
    });
});

// ===========================================================================
describe("Caustic Bronco — attack trigger (CR 701.20a / 702.171b)", () => {
    it("unsaddled: the revealed card goes to hand and its controller loses life equal to its mana value", () => {
        const state = broncoBoard([], { library: [grizzlyBears().id] });
        attackWithBronco(state);
        expect(broncoTriggers(state)).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("lib-0");
        expect(life(state, "p1")).toBe(18);
        expect(life(state, "p2")).toBe(20);
    });

    it("saddled: each opponent loses that life instead", () => {
        const state = broncoBoard(
            [
                { id: "bear-a", cardId: grizzlyBears().id },
                { id: "bear-b", cardId: grizzlyBears().id },
            ],
            { library: [grizzlyBears().id] }
        );
        saddleAndResolve(state, ["bear-a", "bear-b"]);
        attackWithBronco(state);
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("lib-0");
        expect(life(state, "p1")).toBe(20);
        expect(life(state, "p2")).toBe(18);
    });

    it("an empty library reveals nothing and nobody loses life (CR 609.3)", () => {
        const state = broncoBoard([]);
        attackWithBronco(state);
        resolveTopOfStack(state);
        expect(life(state, "p1")).toBe(20);
        expect(life(state, "p2")).toBe(20);
    });

    it("CR 608.2h — a saddled Bronco destroyed with its trigger on the stack still makes the opponent lose the life", () => {
        const state = broncoBoard(
            [
                { id: "bear-a", cardId: grizzlyBears().id },
                { id: "bear-b", cardId: grizzlyBears().id },
            ],
            { library: [grizzlyBears().id] }
        );
        saddleAndResolve(state, ["bear-a", "bear-b"]);
        attackWithBronco(state);
        expect(broncoTriggers(state)).toHaveLength(1);
        removePermanentTo(state, "bronco", "graveyard", "destroy");
        expect(broncoOf(state)).toBeUndefined();
        resolveTopOfStack(state);
        expect(life(state, "p1")).toBe(20);
        expect(life(state, "p2")).toBe(18);
    });

    it("CR 400.7 — a blinked Bronco is a new object: the trigger still reads the saddled one it came from", () => {
        const state = broncoBoard(
            [
                { id: "bear-a", cardId: grizzlyBears().id },
                { id: "bear-b", cardId: grizzlyBears().id },
            ],
            { library: [grizzlyBears().id] }
        );
        saddleAndResolve(state, ["bear-a", "bear-b"]);
        attackWithBronco(state);
        // Leaves and returns under the same instance id, unsaddled.
        removePermanentTo(state, "bronco", "exile");
        const exiled = state.players[0].exile.find((c) => c.id === "bronco")!;
        state.players[0].exile = state.players[0].exile.filter(
            (c) => c.id !== "bronco"
        );
        state.players[0].battlefield.push({ ...exiled, zone: "battlefield" });
        expect(broncoOf(state)!.saddled).toBeUndefined();
        resolveTopOfStack(state);
        expect(life(state, "p1")).toBe(20);
        expect(life(state, "p2")).toBe(18);
    });
});

// ===========================================================================
describe("objectMatchesFilter on $source — last known information is OPT-IN (CR 608.2h)", () => {
    /** Caustic Bronco with its saddled check stripped of `lastKnown`: the
     *  default form, which other cards use as a "the source is still here"
     *  gate ("if you do" after a self-sacrifice). */
    function withoutLastKnown(): CardDefinition {
        const def = causticBronco();
        const [trigger] = def.triggeredAbilities!;
        // The trigger's `matches` is a closure; only its JSON script is copied.
        const effects = JSON.parse(
            JSON.stringify(trigger.effects)
        ) as EffectOp[];
        const branch = effects[1] as Extract<EffectOp, { op: "if" }>;
        delete (branch.predicate as EffectObjectMatchesFilterPredicate)
            .lastKnown;
        return {
            ...def,
            triggeredAbilities: [{ ...trigger, effects }],
        };
    }

    it("without the opt-in, a departed source reads false — never its last known state", () => {
        const def = withoutLastKnown();
        withTemporaryDefinition(def, () => {
            const state = broncoBoard(
                [
                    { id: "bear-a", cardId: grizzlyBears().id },
                    { id: "bear-b", cardId: grizzlyBears().id },
                ],
                { library: [grizzlyBears().id] }
            );
            saddleAndResolve(state, ["bear-a", "bear-b"]);
            attackWithBronco(state);
            removePermanentTo(state, "bronco", "graveyard", "destroy");
            resolveTopOfStack(state);
            // The gate read false: the else branch ran.
            expect(life(state, "p1")).toBe(18);
            expect(life(state, "p2")).toBe(20);
        });
    });

    it("the opt-in is valid only on $source", () => {
        const errors = validateEffectScript({
            id: "test-host",
            name: "Test Host",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                objectMatchesFilter: { ref: "$each" },
                                filter: { saddled: true },
                                lastKnown: true,
                            },
                            then: [
                                { op: "draw", player: "controller", count: 1 },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(errors.length).toBeGreaterThan(0);
    });
});

// ===========================================================================
describe("EffectCardFilter.saddled — battlefield-only (CR 702.171b)", () => {
    const host = (effects: EffectOp[]) => ({
        id: "test-host",
        name: "Test Host",
        effects,
    });

    it("is accepted on objectMatchesFilter", () => {
        expect(
            validateAbilityEffectScript(
                host([
                    {
                        op: "if",
                        predicate: {
                            objectMatchesFilter: { ref: "$source" },
                            filter: { saddled: true },
                        },
                        then: [{ op: "draw", player: "controller", count: 1 }],
                    },
                ]),
                "Test Card"
            )
        ).toEqual([]);
    });

    it("is rejected on a graveyard selector — only permanents can be saddled", () => {
        const errors = validateEffectScript(
            host([
                {
                    op: "forEach",
                    select: {
                        set: "graveyard",
                        controller: "controller",
                        filter: { type: "Creature", saddled: true },
                    },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            to: "hand",
                        },
                    ],
                },
            ])
        );
        expect(errors.some((e) => /field "select"/.test(e))).toBe(true);
    });
});
