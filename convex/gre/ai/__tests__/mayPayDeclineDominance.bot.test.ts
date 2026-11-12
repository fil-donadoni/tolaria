// CR 104.3e — a `may-pay` decline that loses the game is pruned from the tree
// while an accept is payable (issue #8854).
//
// THE BUG. A Pact's upkeep ("pay {2}{G}{G}. If you don't, you lose the game.")
// offered the decline as its own branch. ISMCTS backs the MEAN of a choice
// node's children up to the move that raised it, so the visits the losing
// decline took dragged the cast below `pass`: the Bot never cast a tutor Pact
// whose upkeep fell inside the search horizon.
//
// Every choice here is the engine's own, raised by really resolving the spell
// through `resolveTopOfStack`: the derivation reads the SOURCE stack item, which
// a hand-built `PendingChoice` would not carry.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import {
    resolveTopOfStack,
    type GameState,
    type PendingChoice,
} from "../../state";
import { choiceCandidates } from "../choiceCandidates";
import { declineLosesGame } from "../searchDestination";
import { forest } from "../../../cards/sets/lea/index.cards";
import { registerTokenDefinition } from "../../../cards";
import type { CardDefinition, EffectOp } from "../../../cards/types";

const ME = "p1";
const OPP = "p2";

const MAY_PAY: EffectOp = {
    op: "mayPay",
    player: "controller",
    cost: { G: 1 },
    prompt: "Pay {G}?",
    bind: "$paid",
} as EffectOp;

/** A sorcery whose script is `mayPay {G}` followed by `rest`. */
function register(id: string, rest: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: {},
        types: ["Sorcery"],
        effects: [MAY_PAY, ...rest],
    } as CardDefinition);
    return id;
}

const UNPAID_LOSES = register("test-8854-unpaid-loses", [
    {
        op: "if",
        predicate: { not: { binding: "$paid" } },
        then: [{ op: "loseGame", player: "controller" }],
    } as EffectOp,
]);

const PAID_ELSE_LOSES = register("test-8854-paid-else-loses", [
    {
        op: "if",
        predicate: { binding: "$paid" },
        then: [],
        else: [{ op: "loseGame", player: "controller" }],
    } as EffectOp,
]);

const UNPAID_COSTS_LIFE = register("test-8854-unpaid-costs-life", [
    {
        op: "if",
        predicate: { not: { binding: "$paid" } },
        then: [{ op: "loseLife", player: "controller", amount: 3 }],
    } as EffectOp,
]);

/** The live `may-pay` choice of `spellId`, its controller holding `forests`
 *  untapped Forests. */
function openMayPay(
    spellId: string,
    forests: number
): { state: GameState; choice: PendingChoice } {
    const state = makeState({
        players: [
            makePlayer(ME, {
                battlefield: Array.from({ length: forests }, () =>
                    makeInstance(forest().id, {
                        controllerId: ME,
                        ownerId: ME,
                    })
                ),
            }),
            makePlayer(OPP),
        ],
    });
    pushSpell(state, spellId, ME);
    resolveTopOfStack(state);
    const choice = state.pendingChoices?.[0];
    if (!choice || choice.kind !== "may-pay") {
        throw new Error(
            `expected a live may-pay choice, got ${choice?.kind ?? "none"}`
        );
    }
    return { state, choice };
}

function keys(state: GameState, choice: PendingChoice): string[] {
    return choiceCandidates(state, choice).map((c) => c.key);
}

describe("a game-losing may-pay decline is pruned while the payment is in reach (CR 104.3e)", () => {
    it("drops the decline when the unpaid arm loses the game", () => {
        const { state, choice } = openMayPay(UNPAID_LOSES, 1);
        expect(keys(state, choice)).toEqual(["may-pay:yes"]);
    });

    it("drops the decline when the loss is the paid test's else arm", () => {
        const { state, choice } = openMayPay(PAID_ELSE_LOSES, 1);
        expect(keys(state, choice)).toEqual(["may-pay:yes"]);
    });

    it("keeps the decline when nothing can pay — it is the only answer", () => {
        const { state, choice } = openMayPay(UNPAID_LOSES, 0);
        expect(keys(state, choice)).toEqual(["may-pay:no"]);
    });

    it("keeps the decline when the unpaid arm costs something short of the game", () => {
        const { state, choice } = openMayPay(UNPAID_COSTS_LIFE, 1);
        expect(keys(state, choice).sort()).toEqual([
            "may-pay:no",
            "may-pay:yes",
        ]);
    });
});

describe("declineLosesGame", () => {
    it("is true for the unpaid arm's loss of the controller", () => {
        const { state, choice } = openMayPay(UNPAID_LOSES, 1);
        expect(declineLosesGame(state, choice)).toBe(true);
    });

    it("is false for a choice the stack item's controller does not make", () => {
        const { state, choice } = openMayPay(UNPAID_LOSES, 1);
        expect(declineLosesGame(state, { ...choice, playerId: OPP })).toBe(
            false
        );
    });

    it("is false for an unpaid arm that does not end the game", () => {
        const { state, choice } = openMayPay(UNPAID_COSTS_LIFE, 1);
        expect(declineLosesGame(state, choice)).toBe(false);
    });
});
