// The doomed-mana-source float window (issue #8355, `ai/doomedManaFloat.ts`).
//
// CR 605.3a — a mana ability may be activated whenever its controller holds
// priority; CR 106.4 — the mana stays in the pool until the step or phase
// ends. So when an item on the stack is about to remove an untapped mana
// source, tapping it in response keeps its mana for a spend after the
// resolution. The enumerator offers that standalone activation in exactly
// this window, and only when the floated mana has a spender.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { enumerateMoves, onlyPassIsLegal } from "../moves";
import type { Move } from "../moves";
import { applyMoveInSearch } from "../search";
import { buildPositionFromSpec } from "../ai/blade/build";
import { findBladeScenario } from "../ai/blade/registry";
import {
    bladeScenarioAtSeed,
    bladeScenarioSeeds,
    runBladeScenario,
} from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import type { GameState } from "../state";

const SPENDER_LABEL =
    "doomed mana float: City of Traitors taps in response to its own sacrifice to fund a three-drop (#8355)";
const NO_SPENDER_LABEL =
    "doomed mana float: City of Traitors with no spender lets the sacrifice resolve (#8355)";

function entry(label: string): BladeScenario {
    const found = findBladeScenario(label);
    if (!found) throw new Error(`missing blade entry: ${label}`);
    return found;
}

function build(label: string): GameState {
    const scenario = entry(label);
    return buildPositionFromSpec(scenario.spec, scenario.setup, label);
}

const me = (state: GameState) => state.players[0];

function idOf(state: GameState, seat: 0 | 1, name: string): string {
    const defId = getCardByName(name).id;
    const card = state.players[seat].battlefield.find(
        (c) => (c.card as { id?: string }).id === defId
    );
    if (!card) throw new Error(`no ${name} on seat ${seat}'s battlefield`);
    return card.id;
}

function floats(moves: Move[]) {
    return moves.filter((m) => m.kind === "activate-mana-ability");
}

describe("doomed mana source float — enumeration (CR 605.3a / 106.4)", () => {
    it("City of Traitors' sacrifice trigger on the stack + a spender: the float is offered for City", () => {
        const state = build(SPENDER_LABEL);
        expect(state.stack).toHaveLength(1);
        const moves = enumerateMoves(state, me(state).id);
        expect(floats(moves)).toEqual([
            {
                kind: "activate-mana-ability",
                cardInstanceId: idOf(state, 0, "City of Traitors"),
            },
        ]);
    });

    it("the same trigger with no spender offers no float", () => {
        const state = build(NO_SPENDER_LABEL);
        expect(state.stack).toHaveLength(1);
        expect(floats(enumerateMoves(state, me(state).id))).toEqual([]);
    });

    it("a spell too big even for the floated mana is no spender", () => {
        const scenario = entry(NO_SPENDER_LABEL);
        const state = buildPositionFromSpec(
            {
                ...scenario.spec,
                cards: [
                    ...scenario.spec.cards,
                    { name: "Giant Spider", owner: "me", zone: "hand" },
                ],
            },
            scenario.setup,
            "no-spender + a {3}{G} creature"
        );
        expect(state.stack).toHaveLength(1);
        expect(floats(enumerateMoves(state, me(state).id))).toEqual([]);
    });

    it("a spell castable with or without the float is no spender: the float must enable something", () => {
        const scenario = entry(NO_SPENDER_LABEL);
        const state = buildPositionFromSpec(
            {
                ...scenario.spec,
                cards: [
                    ...scenario.spec.cards,
                    { name: "Llanowar Elves", owner: "me", zone: "hand" },
                ],
            },
            scenario.setup,
            "no-spender + a one-drop the Forest pays alone"
        );
        expect(state.stack).toHaveLength(1);
        expect(floats(enumerateMoves(state, me(state).id))).toEqual([]);
    });

    it("an opponent's land destruction aimed at the source, with an instant castable off its mana, opens the same window", () => {
        const state = buildPositionFromSpec(
            {
                cards: [
                    { name: "Forest", owner: "me", zone: "battlefield" },
                    {
                        name: "Grizzly Bears",
                        owner: "me",
                        zone: "battlefield",
                        summoningSick: false,
                    },
                    { name: "Giant Growth", owner: "me", zone: "hand" },
                    {
                        name: "Mountain",
                        owner: "opp",
                        zone: "battlefield",
                        count: 3,
                    },
                    { name: "Stone Rain", owner: "opp", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 4,
                activePlayer: "opp",
                libraryCount: 20,
            },
            [{ kind: "cast", card: "Stone Rain", by: "opp", target: "Forest" }],
            "opponent Stone Rain on the Forest"
        );
        expect(state.priorityPlayerId).toBe(me(state).id);
        expect(floats(enumerateMoves(state, me(state).id))).toEqual([
            {
                kind: "activate-mana-ability",
                cardInstanceId: idOf(state, 0, "Forest"),
            },
        ]);
    });

    it("an untapped source with a spender but nothing on the stack enumerates no float", () => {
        const state = buildPositionFromSpec(
            {
                cards: [
                    {
                        name: "City of Traitors",
                        owner: "me",
                        zone: "battlefield",
                    },
                    { name: "Forest", owner: "me", zone: "battlefield" },
                    {
                        name: "Sentinel of the Nameless City",
                        owner: "me",
                        zone: "hand",
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 4,
                libraryCount: 20,
            },
            undefined,
            "no stack"
        );
        const moves = enumerateMoves(state, me(state).id);
        expect(moves.some((m) => m.kind === "cast-spell")).toBe(true);
        expect(floats(moves)).toEqual([]);
    });

    it("a stack item that removes no mana source enumerates no float", () => {
        const state = buildPositionFromSpec(
            {
                cards: [
                    { name: "Forest", owner: "me", zone: "battlefield" },
                    {
                        name: "Grizzly Bears",
                        owner: "me",
                        zone: "battlefield",
                        summoningSick: false,
                    },
                    { name: "Giant Growth", owner: "me", zone: "hand" },
                    { name: "Mountain", owner: "opp", zone: "battlefield" },
                    { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 4,
                activePlayer: "opp",
                libraryCount: 20,
                life: { me: 20, opp: 20 },
            },
            [{ kind: "cast", card: "Lightning Bolt", by: "opp", target: "me" }],
            "opponent Bolt to the face"
        );
        expect(state.priorityPlayerId).toBe(me(state).id);
        expect(floats(enumerateMoves(state, me(state).id))).toEqual([]);
    });

    it("the forced-pass fast path (issue #4460) does not skip the window", () => {
        const state = build(SPENDER_LABEL);
        expect(onlyPassIsLegal(state, me(state).id)).toBe(false);
    });
});

describe("doomed mana source float — the controller's own land pick (CR 608.2d, issue #9698)", () => {
    const AMULET_LABEL =
        "bounce land: Amulet of Vigor's untapped bounce land taps for mana before its return resolves";
    const CHAMBER_LABEL =
        "bounce land: Simic Growth Chamber taps the other land before returning it";

    it("a bounce land's return parks on a land pick: each land the pick can return is doomed under that answer", () => {
        const state = build(AMULET_LABEL);
        expect(state.stack).toHaveLength(1);
        const offered = floats(enumerateMoves(state, me(state).id))
            .map((m) => m.cardInstanceId)
            .sort();
        expect(offered).toEqual(
            [
                idOf(state, 0, "Forest"),
                idOf(state, 0, "Simic Growth Chamber"),
            ].sort()
        );
    });

    it("the other land is floated when the return would take it, with a one-drop to spend on", () => {
        const state = build(CHAMBER_LABEL);
        expect(floats(enumerateMoves(state, me(state).id))).toEqual([
            {
                kind: "activate-mana-ability",
                cardInstanceId: idOf(state, 0, "Forest"),
            },
        ]);
    });

    it("the same land pick with no spender offers no float", () => {
        const scenario = entry(CHAMBER_LABEL);
        const state = buildPositionFromSpec(
            {
                ...scenario.spec,
                cards: scenario.spec.cards.filter(
                    (c) => c.name !== "Llanowar Elves"
                ),
            },
            scenario.setup,
            "bounce land, no spender"
        );
        expect(state.stack).toHaveLength(1);
        expect(floats(enumerateMoves(state, me(state).id))).toEqual([]);
    });
});

describe("doomed mana source float — a resolution that parks on a choice (CR 701.23b, issue #9865)", () => {
    const SAGA_LABEL =
        "saga: Urza's Saga floats its mana before chapter III's search sacrifices it";

    it("chapter III's library search on the stack + a spender: the float is offered for Urza's Saga", () => {
        const state = build(SAGA_LABEL);
        expect(state.stack).toHaveLength(1);
        expect(state.priorityPlayerId).toBe(me(state).id);
        expect(floats(enumerateMoves(state, me(state).id))).toEqual([
            {
                kind: "activate-mana-ability",
                cardInstanceId: idOf(state, 0, "Urza's Saga"),
            },
        ]);
    });

    it("the same search with no spender offers no float", () => {
        // No Frogmite, and an Island for Fiery Islet: the Islet's own
        // "{1}, {T}, sacrifice" draw is a spender only the floated {C} pays.
        const scenario = entry(SAGA_LABEL);
        const state = buildPositionFromSpec(
            {
                ...scenario.spec,
                cards: scenario.spec.cards.flatMap((c) =>
                    c.name === "Frogmite"
                        ? []
                        : c.name === "Fiery Islet"
                          ? [{ ...c, name: "Island" }]
                          : [c]
                ),
            },
            scenario.setup,
            "Urza's Saga chapter III, no spender"
        );
        expect(state.stack).toHaveLength(1);
        expect(floats(enumerateMoves(state, me(state).id))).toEqual([]);
    });

    it("a parked choice the sandbox cannot answer still fails closed", () => {
        // Chapter III swapped for a mandatory pick of a card in hand that is
        // no discard: neither a search's empty find nor a forced answer, so
        // the probe cannot settle the resolution and offers nothing rather
        // than guess — even though the Saga is still sacrificed after it.
        const saga = getCardByName("Urza's Saga");
        const [first, second, third] = saga.chapterAbilities!;
        const unanswerable: CardDefinition = {
            ...saga,
            chapterAbilities: [
                first,
                second,
                {
                    ...third,
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-hand-card",
                            player: "controller",
                            zone: "hand",
                            count: 1,
                            prompt: "Choose a card in your hand.",
                            bind: "$chosen",
                        },
                    ],
                },
            ],
        };
        const scenario = entry(SAGA_LABEL);
        withTemporaryDefinition(unanswerable, () => {
            const state = buildPositionFromSpec(
                scenario.spec,
                scenario.setup,
                "Urza's Saga chapter III, an unanswerable hand pick"
            );
            expect(state.stack).toHaveLength(1);
            expect(floats(enumerateMoves(state, me(state).id))).toEqual([]);
        });
    });
});

describe("doomed mana source float — search application (CR 605.3b / 106.4)", () => {
    it("the float keeps {C}{C} in the pool through the sacrifice, and the three-drop is castable after it", () => {
        const state = build(SPENDER_LABEL);
        const bot = me(state).id;
        const opp = state.players[1].id;
        const cityId = idOf(state, 0, "City of Traitors");
        const [float] = floats(enumerateMoves(state, bot));
        applyMoveInSearch(state, bot, float);
        // A mana ability does not use the stack and priority stays put.
        expect(state.stack).toHaveLength(1);
        expect(state.priorityPlayerId).toBe(bot);
        expect(me(state).manaPool.C).toBe(2);
        expect(
            me(state).battlefield.find((c) => c.id === cityId)?.isTapped
        ).toBe(true);

        applyMoveInSearch(state, bot, { kind: "pass" });
        applyMoveInSearch(state, opp, { kind: "pass" });
        expect(state.stack).toHaveLength(0);
        expect(state.phase).toBe("PRECOMBAT_MAIN");
        expect(me(state).battlefield.some((c) => c.id === cityId)).toBe(false);
        expect(me(state).manaPool.C).toBe(2);
        const casts = enumerateMoves(state, bot).filter(
            (m) => m.kind === "cast-spell"
        );
        expect(casts).toHaveLength(1);
    });
});

const SAGA_LABEL =
    "saga: Urza's Saga floats its mana before chapter III's search sacrifices it";

/** Every declared seed of each entry, one row per (entry, seed): a whole seed
 *  loop in one `it` timed out at 60 s under a contended health gate. */
function seedRows(labels: string[]): [string, number][] {
    return labels.flatMap((label) =>
        bladeScenarioSeeds(entry(label)).map((seed): [string, number] => [
            label,
            seed,
        ])
    );
}

function runAtSeed(label: string, seed: number) {
    return runBladeScenario(bladeScenarioAtSeed(entry(label), seed));
}

describe("doomed mana source float — blade discriminating pair", () => {
    it.each(seedRows([SPENDER_LABEL, NO_SPENDER_LABEL]))(
        "%s (seed %i)",
        (label, seed) => {
            const result = runAtSeed(label, seed);
            expect(result.ok, result.failureMessage).toBe(true);
        }
    );
});

describe("doomed mana source float — Urza's Saga chapter III (issue #9865)", () => {
    it.each(bladeScenarioSeeds(entry(SAGA_LABEL)))(
        "blade: the Saga floats its mana before chapter III's search sacrifices it (seed %i)",
        (seed) => {
            const result = runAtSeed(SAGA_LABEL, seed);
            expect(result.ok, result.failureMessage).toBe(true);
        }
    );
});
