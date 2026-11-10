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
import { enumerateMoves, onlyPassIsLegal } from "../moves";
import type { Move } from "../moves";
import { applyMoveInSearch } from "../search";
import { buildPositionFromSpec } from "../ai/blade/build";
import { findBladeScenario } from "../ai/blade/registry";
import { runBladeScenario } from "../ai/blade/runner";
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

describe("doomed mana source float — blade discriminating pair", () => {
    it.each([SPENDER_LABEL, NO_SPENDER_LABEL])("%s", (label) => {
        const result = runBladeScenario(entry(label));
        expect(result.ok, result.failureMessage).toBe(true);
    });
});
