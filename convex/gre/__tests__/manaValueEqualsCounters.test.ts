// CR 202.3 / 122.1 (issue #10505) — `EffectCardFilter.manaValueEquals` reading
// a counter tally: "a creature card with mana value equal to the number of
// charge counters on this artifact". The tally is read as the ability RESOLVES
// and, when the source has left the battlefield, as it last existed there
// (CR 608.2h).
//
// Driven through the real activation commit (`activateAbilityOnState`) on the
// shipped carrier (Aether Vial) and read through `projectPublicState`.

import { describe, it, expect } from "vitest";
import { activateAbilityOnState } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { getCardByName, registerTokenDefinition } from "../../cards";
import { phaseTrigger } from "../../cards/abilities/triggers/phaseTrigger";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import {
    type CardInstanceState,
    type GameState,
    removePermanentTo,
    resolveTopOfStack,
} from "../state";
import { compactState, expandState } from "../serialize";
import { validateEffectScript } from "../effects/validate";
import type { EffectOp } from "../../cards/types";

const VIAL = getCardByName("Aether Vial").id;

function inHand(id: string, name: string): CardInstanceState {
    return makeInstance(getCardByName(name).id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
}

/** Aether Vial with `charge` counters; a mana value 1 and a mana value 2
 *  creature card, and a mana value 2 noncreature card, in hand. */
function board(charge: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(VIAL, {
                        id: "vial",
                        controllerId: "p1",
                        ownerId: "p1",
                        ...(charge > 0 ? { counters: { charge } } : {}),
                    }),
                ],
                hand: [
                    inHand("mv1", "Llanowar Elves"),
                    inHand("mv2", "Grizzly Bears"),
                    inHand("rock", "Fellwar Stone"),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

function activate(state: GameState): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "vial",
        abilityId: "aether-vial-put",
    });
}

const vialOf = (state: GameState) =>
    state.players[0].battlefield.find((c) => c.id === "vial")!;

const offered = (state: GameState) =>
    state.pendingChoices?.[0]?.candidateIds ?? [];

describe("manaValueEquals over a counter tally (CR 202.3, CR 122.1)", () => {
    it("offers exactly the creature cards of that mana value and puts the pick onto the battlefield", () => {
        const state = board(2);
        activate(state);
        resolveTopOfStack(state);
        expect(offered(state)).toEqual(["mv2"]);

        submitChoice(state, ["mv2"]);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield.map((c) => c.id)).toEqual([
            "vial",
            "mv2",
        ]);
        expect(state.stack).toHaveLength(0);
    });

    it("the put is optional — declining leaves the card in hand", () => {
        const state = board(2);
        activate(state);
        resolveTopOfStack(state);
        submitChoice(state, []);
        expect(state.players[0].hand.map((c) => c.id)).toContain("mv2");
        expect(state.stack).toHaveLength(0);
    });

    it("no counters reads zero: no creature card here qualifies and nothing is asked", () => {
        const state = board(0);
        activate(state);
        resolveTopOfStack(state);
        expect(offered(state)).toEqual([]);
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.stack).toHaveLength(0);
    });

    it("the tally is read on resolution, not on activation (CR 608.2h)", () => {
        const state = board(1);
        activate(state);
        vialOf(state).counters = { charge: 2 };
        resolveTopOfStack(state);
        expect(offered(state)).toEqual(["mv2"]);
    });
});

describe("the source left before the ability resolved (CR 608.2h)", () => {
    it("answers with the counters it had as it left, not those at activation", () => {
        const state = board(1);
        activate(state);
        vialOf(state).counters = { charge: 2 };
        removePermanentTo(state, "vial", "graveyard");
        // A save point between the departure and the resolution.
        const reloaded = expandState(compactState(state));
        resolveTopOfStack(reloaded);
        expect(offered(reloaded)).toEqual(["mv2"]);
    });

    it("a same-id permanent that re-entered is a new object (CR 400.7)", () => {
        const state = board(2);
        activate(state);
        removePermanentTo(state, "vial", "exile");
        const [vial] = state.players[0].exile.splice(0, 1);
        state.players[0].battlefield.push({
            ...vial,
            zone: "battlefield",
            counters: { charge: 1 },
        });
        resolveTopOfStack(state);
        expect(offered(state)).toEqual(["mv2"]);
    });

    it("a trigger's departed source answers the same way", () => {
        const id = "mv-equals-counters-trigger-host";
        registerTokenDefinition({
            id,
            name: id,
            rarity: "common",
            types: ["Artifact"],
            triggeredAbilities: [
                phaseTrigger({
                    id: "tally-gain",
                    oracleText:
                        "At the beginning of your upkeep, you gain life equal to the number of charge counters on this artifact.",
                    phase: "UPKEEP",
                    scope: "your",
                    effects: [
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: {
                                counters: {
                                    of: { ref: "$source" },
                                    type: "charge",
                                },
                            },
                        },
                    ],
                }),
            ],
        });
        const host = makeInstance(id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            counters: { charge: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host], life: 20 }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...host,
            id: "host-trigger",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "tally-gain",
            triggerSourceId: "host",
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            },
            targets: [],
        });
        removePermanentTo(state, "host", "graveyard");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
    });
});

describe("a last-known tally never revives a departed permanent's upkeep choice", () => {
    /** `name`'s upkeep trigger resolving after the permanent left — and, with
     *  `reenter`, after a same-id new object took its place. */
    function upkeepAfterDeparture(
        name: string,
        triggeredAbilityId: string,
        counters: Record<string, number>,
        reenter: boolean
    ): GameState {
        const source = makeInstance(getCardByName(name).id, {
            id: "source",
            controllerId: "p1",
            ownerId: "p1",
            counters,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...source,
            id: "source-trigger",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId,
            triggerSourceId: "source",
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            },
            targets: [],
        });
        removePermanentTo(state, "source", "exile");
        if (reenter) {
            const [card] = state.players[0].exile.splice(0, 1);
            state.players[0].battlefield.push({ ...card, zone: "battlefield" });
        }
        resolveTopOfStack(state);
        return state;
    }

    for (const reenter of [false, true]) {
        const how = reenter ? "re-entered" : "left";
        it(`cumulative upkeep asks for nothing: the permanent ${how} (CR 702.24a)`, () => {
            const state = upkeepAfterDeparture(
                "Mystic Remora",
                "cumulative-upkeep",
                { age: 2 },
                reenter
            );
            expect(state.pendingChoices ?? []).toEqual([]);
            expect(state.stack).toHaveLength(0);
            const board = state.players[0].battlefield;
            expect(board).toHaveLength(reenter ? 1 : 0);
            expect(board[0]?.counters).toBeUndefined();
        });

        it(`Tetravus offers no counter removal: it ${how}`, () => {
            const state = upkeepAfterDeparture(
                "Tetravus",
                "tetravus-counters-to-tokens",
                { "+1/+1": 3 },
                reenter
            );
            expect(state.pendingChoices ?? []).toEqual([]);
            expect(state.stack).toHaveLength(0);
        });
    }
});

describe("validator: the counter form of manaValueEquals", () => {
    const script = (manaValueEquals: unknown) => ({
        id: "mv-equals-counters-host",
        name: "Host",
        effects: [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                filter: { manaValueEquals },
                count: { min: 0, max: 1 },
                prompt: "Pick.",
                bind: "$picked",
            },
        ] as unknown as EffectOp[],
    });

    it("accepts a well-formed tally and refuses a malformed one", () => {
        const of = { target: 0 };
        expect(
            validateEffectScript({
                ...script({ counters: { of, type: "charge" } }),
                targetRequirement: { type: "permanent", count: 1 },
            } as never)
        ).toEqual([]);
        for (const bad of [
            { counters: { of, type: "" } },
            { counters: { type: "charge" } },
            { counters: { of, type: "charge" }, X: true },
        ]) {
            expect(
                validateEffectScript(script(bad) as never).length
            ).toBeGreaterThan(0);
        }
    });
});
