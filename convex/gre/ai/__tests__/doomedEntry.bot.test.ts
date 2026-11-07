/**
 * A body a script puts onto the battlefield and removes before it could fight
 * (CR 603.7a, CR 603.7b): the search below the root stops re-offering the move.
 * The blade entries are the `cheat into play` pair; this file names the mechanism.
 */

import { describe, expect, it } from "vitest";
import type { DelayedTriggerTiming, EffectOp } from "../../../cards/types";
import { getCardByName } from "../../../cards";
import { buildBladeState, findBladeScenario } from "../blade";
import { seatPlayerId } from "../blade/matcher";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { cloneGameState } from "../../clone";
import { enumerateMoves, type Move } from "../../moves";
import { makeRng } from "../../rng";
import {
    applyMoveInSearch,
    isDoomedEntryMove,
    rollout,
    searchWithTrace,
} from "../../search";
import type { GameState } from "../../state";
import type { Phase } from "../../types";
import {
    enteringBodyDepartureTiming,
    fightsBeforeDeparture,
} from "../doomedEntry";

const HOLDS = "cheat into play: holds Sneak Attack after combat";
const ACTIVATES =
    "cheat into play: activates Sneak Attack at the beginning of combat";

function stateOf(label: string, opposingCreature = false): GameState {
    const entry = findBladeScenario(label);
    if (!entry) throw new Error(`No blade entry "${label}"`);
    if (!opposingCreature) return buildBladeState(entry);
    return buildBladeState({
        ...entry,
        spec: {
            ...entry.spec,
            cards: [
                ...(entry.spec.cards ?? []),
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
        },
    });
}

/** Whether a body entering under the bot's seat fights, at `phase` of `active`'s
 *  turn, before a `timing` trigger removes it. */
function fights(
    phase: Phase,
    active: "me" | "opp",
    timing: DelayedTriggerTiming = "next-end-step",
    opposingCreature = false
): boolean {
    const state = stateOf(HOLDS, opposingCreature);
    state.phase = phase;
    state.activePlayerId = seatPlayerId(state, active);
    return fightsBeforeDeparture(state, seatPlayerId(state, "me"), timing);
}

describe("a body's window before its departure (CR 603.7b)", () => {
    it("after combat, an end-step departure leaves it no combat", () => {
        expect(fights("POSTCOMBAT_MAIN", "me")).toBe(false);
        expect(fights("END_OF_COMBAT", "me")).toBe(false);
    });

    it("with its own attack ahead, it fights", () => {
        expect(fights("PRECOMBAT_MAIN", "me")).toBe(true);
        expect(fights("BEGINNING_OF_COMBAT", "me")).toBe(true);
    });

    it("past the declaration of attackers, it is too late for this combat", () => {
        expect(fights("DECLARE_BLOCKERS", "opp")).toBe(false);
        expect(fights("COMBAT_DAMAGE", "me")).toBe(false);
        expect(fights("COMBAT_DAMAGE", "me", "next-end-of-combat")).toBe(false);
    });

    it("in the declare-attackers step, it fights only an attack declared against it", () => {
        const state = stateOf(HOLDS);
        const me = seatPlayerId(state, "me");
        const opp = seatPlayerId(state, "opp");
        state.phase = "DECLARE_ATTACKERS";
        state.activePlayerId = opp;
        const window = (): boolean =>
            fightsBeforeDeparture(state, me, "next-end-step");
        expect(window()).toBe(false);
        state.combat = {
            attackerIds: [],
            confirmed: true,
        } as unknown as GameState["combat"];
        expect(window()).toBe(false);
        state.combat = {
            attackerIds: ["an attacker"],
            confirmed: true,
        } as unknown as GameState["combat"];
        expect(window()).toBe(true);
        state.activePlayerId = me;
        expect(window()).toBe(false);
    });

    it("created in the opponent's end step, it lasts through its own attack", () => {
        expect(fights("END_STEP", "opp")).toBe(true);
    });

    it("created in its own end step, it fights only if there is an attacker to block", () => {
        expect(fights("END_STEP", "me")).toBe(false);
        expect(fights("END_STEP", "me", "next-end-step", true)).toBe(true);
    });

    it("before the opponent's combat, it fights only if there is an attacker to block", () => {
        expect(fights("UPKEEP", "opp")).toBe(false);
        expect(fights("UPKEEP", "opp", "next-end-step", true)).toBe(true);
    });

    it("a next-upkeep departure after combat leaves it no combat", () => {
        expect(fights("POSTCOMBAT_MAIN", "me", "next-upkeep")).toBe(false);
        expect(fights("POSTCOMBAT_MAIN", "opp", "next-upkeep")).toBe(false);
    });

    it("a next-end-of-combat departure after combat waits for the next turn's", () => {
        expect(fights("POSTCOMBAT_MAIN", "opp", "next-end-of-combat")).toBe(
            true
        );
        expect(fights("POSTCOMBAT_MAIN", "me", "next-end-of-combat")).toBe(
            false
        );
    });

    it("a next-cleanup departure in the end step leaves it no combat", () => {
        expect(fights("END_STEP", "opp", "next-cleanup-step")).toBe(false);
    });
});

describe("the script that dooms its own entry", () => {
    const script = (name: string): readonly EffectOp[] => {
        const card = getCardByName(name);
        return card.effects ?? card.activatedAbilities?.[0]?.effects ?? [];
    };

    /** A script entering `$body`, then scheduling `body` for `timing`. */
    const entering = (
        body: EffectOp[],
        timing: DelayedTriggerTiming = "next-end-step"
    ): EffectOp[] => [
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "hand",
            to: "battlefield",
            bind: "$body",
        },
        {
            op: "delayedTrigger",
            timing,
            oracleText: "",
            capture: { $captured: { ref: "$body" } },
            effects: body,
        },
    ];

    it("reads the shape, whichever card carries it", () => {
        expect(enteringBodyDepartureTiming(script("Sneak Attack"))).toBe(
            "next-end-step"
        );
        expect(enteringBodyDepartureTiming(script("Through the Breach"))).toBe(
            "next-end-step"
        );
    });

    it("reads `destroy` and an `exile` that keeps nothing", () => {
        for (const op of ["destroy", "exile"] as const) {
            expect(
                enteringBodyDepartureTiming(
                    entering([{ op, target: { ref: "$captured" } }])
                )
            ).toBe("next-end-step");
        }
    });

    it("fails closed on every shape it cannot read", () => {
        const unread: EffectOp[][] = [
            // The body keeps its handle on the card: a blink.
            [{ op: "exile", target: { ref: "$captured" }, bind: "$back" }],
            [{ op: "moveZone", target: { ref: "$captured" }, to: "hand" }],
            [{ op: "loseLife", player: "controller", amount: 1 }],
        ];
        for (const body of unread) {
            expect(enteringBodyDepartureTiming(entering(body))).toBeUndefined();
        }
        expect(
            enteringBodyDepartureTiming(
                entering(
                    [{ op: "sacrifice", target: { ref: "$captured" } }],
                    "leaves-battlefield"
                )
            )
        ).toBeUndefined();
    });

    it("does not read a body it did not enter", () => {
        const [, schedule] = entering([
            { op: "sacrifice", target: { ref: "$captured" } },
        ]);
        expect(enteringBodyDepartureTiming([schedule])).toBeUndefined();
    });
});

describe("the move that makes a doomed entry", () => {
    function activation(state: GameState, me: string): Move {
        const found = enumerateMoves(state, me).find(
            (m) => m.kind === "activate-ability"
        );
        if (!found) throw new Error("no activation offered");
        return found;
    }

    it("is dropped after combat, for the bot only", () => {
        const state = stateOf(HOLDS);
        const me = seatPlayerId(state, "me");
        const opp = seatPlayerId(state, "opp");
        const move = activation(state, me);
        expect(isDoomedEntryMove(state, me, me, move)).toBe(true);
        expect(isDoomedEntryMove(state, me, opp, move)).toBe(false);
        expect(isDoomedEntryMove(state, me, me, { kind: "pass" })).toBe(false);
    });

    it("stays open with its attack ahead", () => {
        const state = stateOf(ACTIVATES);
        const me = seatPlayerId(state, "me");
        expect(isDoomedEntryMove(state, me, me, activation(state, me))).toBe(
            false
        );
    });

    it("stays open at the opponent's end step", () => {
        const state = stateOf(HOLDS);
        const me = seatPlayerId(state, "me");
        const move = activation(state, me);
        state.phase = "END_STEP";
        state.activePlayerId = seatPlayerId(state, "opp");
        expect(isDoomedEntryMove(state, me, me, move)).toBe(false);
    });

    it("is never spent by a rollout of the line that holds it", () => {
        const state = stateOf(HOLDS);
        const me = seatPlayerId(state, "me");
        const wurm = getCardByName("Craw Wurm").id;
        for (let seed = 0; seed < 20; seed++) {
            const world = cloneGameState(state);
            applyMoveInSearch(world, me, { kind: "pass" });
            rollout(world, me, makeRng(seed), DEFAULT_EVAL_WEIGHTS);
            const seat = world.players.find((p) => p.id === me)!;
            expect(seat.graveyard.map((c) => c.card.id)).not.toContain(wurm);
        }
    });

    it(
        "leaves the search preferring to hold, with no root rule overriding it",
        { timeout: 240_000 },
        () => {
            for (const seed of [1, 7]) {
                const state = stateOf(HOLDS);
                const me = seatPlayerId(state, "me");
                const { trace } = searchWithTrace(
                    state,
                    me,
                    { iterations: 400 },
                    seed
                );
                expect(trace?.candidates[0].move.kind).toBe("pass");
                expect(trace?.mechanism).not.toBe("last-window-deferral");
            }
        }
    );

    it("reads a spell's script too", () => {
        const entry = findBladeScenario(HOLDS)!;
        const state = buildBladeState({
            ...entry,
            spec: {
                ...entry.spec,
                cards: [
                    { name: "Through the Breach", owner: "me", zone: "hand" },
                    { name: "Craw Wurm", owner: "me", zone: "hand" },
                    {
                        name: "Mountain",
                        owner: "me",
                        zone: "battlefield",
                        count: 5,
                    },
                ],
            },
        });
        const me = seatPlayerId(state, "me");
        const cast = enumerateMoves(state, me).find(
            (m) => m.kind === "cast-spell"
        );
        expect(cast).toBeDefined();
        expect(isDoomedEntryMove(state, me, me, cast!)).toBe(true);
    });
});
