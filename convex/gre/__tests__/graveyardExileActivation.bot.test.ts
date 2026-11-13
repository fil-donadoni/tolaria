// Graveyard-exile activation discipline (issue #9116).
//
// "{W}: Exile target card from a graveyard. If it was a permanent card, put a
// +1/+1 counter on this permanent." The Bot spent it in response to unrelated
// spells, on its OWN graveyard's instants — a pure loss the saturated reward
// band read as a tie with `pass`. Two root-level readings close it, both
// asked of the position through the search's own seams:
//
//   1. `activationBuysNothing` — settled to an empty stack, the activation
//      changes no evaluation term but its own payment (CR 602.2b: the
//      activation cost is paid as a spell's mana cost is; the payoff is
//      only what resolves).
//   2. `actionCommutesWithStack` — acting now and acting once the stack has
//      resolved reach the same position, so the action is no response
//      (`defersPastStack`, the `last-window-deferral` hold's perimeter).
//
// The positions are the blade entries' own (`ai/blade/scenarios.ts`), built
// through the real blade builder. Lion Sash is a FIXTURE for the shape;
// nothing under test reads a card name.
import { describe, expect, it } from "vitest";
import { tryGetDefinition } from "../../cards";
import {
    actionCommutesWithStack,
    activationBuysNothing,
    defersPastStack,
} from "../search";
import { enumerateMoves } from "../moves";
import type { Move } from "../moves";
import type { GameState } from "../state";
import { buildBladeState } from "../ai/blade/build";
import { findBladeScenario } from "../ai/blade/registry";

const RESPONSE_UNRELATED =
    "graveyard exile: holds the rider activation through an unrelated spell";
const RESPONSE_AT_EXILER =
    "graveyard exile: answers a Shock aimed at the exiler with the counter";
const END_OWN_INSTANT =
    "graveyard exile: never exiles its own instant at the opponent's end step";
const END_OWN_PERMANENT =
    "graveyard exile: takes the counter off its own permanent card at the end step";
const END_OPPONENT_REACH =
    "graveyard exile: exiles the opponent's flashback card over its own instant";

function position(label: string): { state: GameState; bot: string } {
    const scenario = findBladeScenario(label);
    if (!scenario) throw new Error(`no blade entry "${label}"`);
    const state = buildBladeState(scenario);
    return { state, bot: state.players[1].id };
}

function nameOf(state: GameState, id: string): string | undefined {
    for (const p of state.players) {
        for (const zone of [p.graveyard, p.battlefield, p.hand, p.exile]) {
            const card = zone.find((c) => c.id === id);
            if (card) {
                const id = (card.card as { id?: string }).id;
                return id ? tryGetDefinition(id)?.name : undefined;
            }
        }
    }
    return undefined;
}

/** The exile activation aimed at the graveyard card named `target`. */
function exileAt(state: GameState, bot: string, target: string): Move {
    const move = enumerateMoves(state, bot).find(
        (m) =>
            m.kind === "activate-ability" &&
            m.targets.some((t) => nameOf(state, t.id) === target)
    );
    if (!move) throw new Error(`no exile activation aimed at ${target}`);
    return move;
}

describe("activationBuysNothing — payment-only activations (CR 602.2b)", () => {
    it("exiling the mover's own instant, with no rider payoff, buys nothing", () => {
        const { state, bot } = position(END_OWN_INSTANT);
        expect(
            activationBuysNothing(
                state,
                bot,
                exileAt(state, bot, "Giant Growth")
            )
        ).toBe(true);
    });

    it("reads the same through an opposing spell still on the stack", () => {
        const { state, bot } = position(RESPONSE_UNRELATED);
        expect(state.stack.length).toBe(1);
        expect(
            activationBuysNothing(
                state,
                bot,
                exileAt(state, bot, "Giant Growth")
            )
        ).toBe(true);
    });

    it("the rider's +1/+1 counter on a permanent card is a payoff", () => {
        const { state, bot } = position(END_OWN_PERMANENT);
        expect(
            activationBuysNothing(
                state,
                bot,
                exileAt(state, bot, "Howling Mine")
            )
        ).toBe(false);
        expect(
            activationBuysNothing(
                state,
                bot,
                exileAt(state, bot, "Giant Growth")
            )
        ).toBe(true);
    });

    it("exiling a card the opponent can still cast from its graveyard is a payoff", () => {
        const { state, bot } = position(END_OPPONENT_REACH);
        expect(
            activationBuysNothing(
                state,
                bot,
                exileAt(state, bot, "Think Twice")
            )
        ).toBe(false);
    });

    it("never claims a pass", () => {
        const { state, bot } = position(END_OWN_INSTANT);
        expect(activationBuysNothing(state, bot, { kind: "pass" })).toBe(false);
    });
});

describe("actionCommutesWithStack — no response without interaction (CR 117.3b, CR 117.3d)", () => {
    it("the counter activation commutes with a Shock aimed at the bot", () => {
        const { state, bot } = position(RESPONSE_UNRELATED);
        const move = exileAt(state, bot, "Howling Mine");
        expect(actionCommutesWithStack(state, bot, move)).toBe(true);
        expect(defersPastStack(state, bot, move)).toBe(true);
    });

    it("does not commute with a Shock aimed at the exiler — the counter is the answer", () => {
        const { state, bot } = position(RESPONSE_AT_EXILER);
        const move = exileAt(state, bot, "Howling Mine");
        expect(actionCommutesWithStack(state, bot, move)).toBe(false);
        expect(defersPastStack(state, bot, move)).toBe(false);
    });

    it("an empty stack commutes trivially", () => {
        const { state, bot } = position(END_OWN_PERMANENT);
        expect(
            actionCommutesWithStack(
                state,
                bot,
                exileAt(state, bot, "Howling Mine")
            )
        ).toBe(true);
    });
});
