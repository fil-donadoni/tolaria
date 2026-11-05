// Bot reachability of a granted exalted (CR 702.83a): a lone attack in the search
// raises the printed and the granted trigger as one CR 603.3b batch, the search can
// name a decider for it, and the answer lands both on the stack, so a playout reaches
// the pump. The ability is the same script the printed keyword prices.
import { describe, expect, it } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { choiceCandidates } from "../ai/choiceCandidates";
import { getEffectivePower } from "../layers";
import { applyMoveInSearch, decidingPlayer } from "../search";
import { beginApplyingStaticEffects, resolveTopOfStack } from "../state";

const outcome = compileCard(
    oracleCard({
        name: "Sublime Archangel",
        manaCost: "{2}{W}{W}",
        typeLine: "Creature — Angel",
        power: "4",
        toughness: "3",
        oracleText:
            "Flying\nExalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)\nOther creatures you control have exalted. (If a creature has multiple instances of exalted, each triggers separately.)",
    })
);
if (outcome.state !== "ready") throw new Error(JSON.stringify(outcome));
const ARCHANGEL = "test-exalted-bot-archangel";
registerTokenDefinition({
    ...outcome.definition,
    id: ARCHANGEL,
    rarity: "common",
} as CardDefinition);

describe("a granted exalted in the search (CR 702.83a, CR 603.3b)", () => {
    it("a lone attack batches both triggers and the answer reaches the pump", () => {
        const bears = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "b",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const archangel = makeInstance(ARCHANGEL, {
            id: "a",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
            players: [
                makePlayer("p1", { battlefield: [archangel, bears] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, archangel);

        applyMoveInSearch(state, "p1", {
            kind: "declare-attackers",
            attackerIds: ["b"],
        });

        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("trigger-order");
        expect(decidingPlayer(state)).toBe("p1");
        const [answer] = choiceCandidates(state, choice!);
        applyMoveInSearch(state, "p1", answer.move);
        expect(state.stack).toHaveLength(2);
        while (state.stack.length > 0) resolveTopOfStack(state);
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "b"
        )!;
        expect(getEffectivePower(state, attacker)).toBe(4);
    });
});
