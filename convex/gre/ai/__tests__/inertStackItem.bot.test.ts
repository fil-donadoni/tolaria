// `isInertStackItemFor` — the reading "keep mana open" shares with the
// quiet-position reading: an opposing stack object that provably cannot touch
// the holder's side, so holding an own-side instant through it costs nothing
// (CR 117.3b / 117.3c). Every doubt answers "not inert".
//
// The cards are FIXTURES, never special cases: nothing under test reads a card
// name. Opt is an untargeted scry-then-draw for its controller, Divination an
// untargeted draw, Wrath of God an untargeted sweep, Lightning Bolt a targeted
// burn spell; Underground Mortuary's enters trigger is a surveil 1 (CR 701.25a).
import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../../cards";
import type { CardDefinition } from "../../../cards/types";
import { isInertStackItemFor } from "../futileShield";
import { buildBladeState } from "../blade/build";
import type { BladeScenario } from "../blade/types";
import type { StackItem } from "../../state";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";

const OPT = getCardByName("Opt").id;
const DIVINATION = getCardByName("Divination").id;
const WRATH = getCardByName("Wrath of God").id;
const BOLT = getCardByName("Lightning Bolt").id;

/** p2 puts objects on the stack; p1 is the holder the reading answers for. */
function bare() {
    return makeState({ players: [makePlayer("p1"), makePlayer("p2")] });
}

/** A real surveil trigger, put on the stack by the engine's own ETB path. */
function surveilTrigger(): { item: StackItem; holder: string } {
    const scenario: BladeScenario = {
        label: "inert-stack-surveil",
        spec: {
            cards: [
                {
                    name: "Underground Mortuary",
                    owner: "me",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayer: "me",
            turn: 5,
            libraryCount: 20,
        },
        setup: [
            {
                kind: "etb-trigger",
                card: "Underground Mortuary",
                controller: "me",
            },
            { kind: "pass", seat: "me" },
        ],
        bot: "opp",
        budget: { iterations: 1 },
        seeds: [1],
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    };
    const state = buildBladeState(scenario);
    expect(state.stack).toHaveLength(1);
    const item = state.stack[0]!;
    const holder = state.players.find((p) => p.id !== item.castById)!.id;
    return { item, holder };
}

describe("an opposing object that acts on its controller alone is inert", () => {
    it("admits a surveil trigger (CR 701.25a) and a draw spell", () => {
        const { item, holder } = surveilTrigger();
        expect(isInertStackItemFor(item, holder)).toBe(true);

        const state = bare();
        expect(isInertStackItemFor(pushSpell(state, OPT, "p2"), "p1")).toBe(
            true
        );
        expect(
            isInertStackItemFor(pushSpell(state, DIVINATION, "p2"), "p1")
        ).toBe(true);
    });
});

describe("every doubt answers not inert", () => {
    it("refuses the holder's own object", () => {
        const { item } = surveilTrigger();
        expect(isInertStackItemFor(item, item.castById)).toBe(false);
    });

    it("refuses a modal object with its modes chosen (CR 700.2)", () => {
        const { item, holder } = surveilTrigger();
        expect(
            isInertStackItemFor({ ...item, chosenModeIds: ["mode-1"] }, holder)
        ).toBe(false);
    });

    it("refuses a modal script, even when every mode is harmless", () => {
        const def: CardDefinition = {
            ...getCardByName("Opt"),
            effects: [
                {
                    op: "optionChoice",
                    player: "controller",
                    prompt: "Choose one",
                    modes: [
                        {
                            label: "Draw",
                            effects: [
                                { op: "draw", player: "controller", count: 1 },
                            ],
                        },
                        {
                            label: "Gain",
                            effects: [
                                {
                                    op: "gainLife",
                                    player: "controller",
                                    amount: 1,
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        withTemporaryDefinition(def, () => {
            const state = bare();
            expect(isInertStackItemFor(pushSpell(state, OPT, "p2"), "p1")).toBe(
                false
            );
        });
    });

    it("refuses a delayed trigger (CR 603.7)", () => {
        const { item, holder } = surveilTrigger();
        expect(
            isInertStackItemFor({ ...item, delayedTriggerId: "d1" }, holder)
        ).toBe(false);
    });

    it("refuses an object whose script cannot be read", () => {
        const state = bare();
        const item = pushSpell(state, OPT, "p2");
        expect(
            isInertStackItemFor(
                { ...item, card: { ...item.card, id: "no-such-card" } },
                "p1"
            )
        ).toBe(false);
    });

    it("refuses any announced target, and an Op that reaches past its controller", () => {
        const state = bare();
        expect(
            isInertStackItemFor(
                pushSpell(state, BOLT, "p2", [{ type: "player", id: "p1" }]),
                "p1"
            )
        ).toBe(false);
        // A sweep names no target and no player: it is never inert.
        expect(isInertStackItemFor(pushSpell(state, WRATH, "p2"), "p1")).toBe(
            false
        );
        const opponentDraws: CardDefinition = {
            ...getCardByName("Divination"),
            effects: [{ op: "draw", player: "opponent", count: 2 }],
        };
        withTemporaryDefinition(opponentDraws, () => {
            expect(
                isInertStackItemFor(pushSpell(bare(), DIVINATION, "p2"), "p1")
            ).toBe(false);
        });
    });
});
