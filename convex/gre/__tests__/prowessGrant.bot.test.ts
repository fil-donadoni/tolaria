// Bot reachability of a granted prowess (CR 702.108b): a noncreature cast in the
// search raises the printed and the granted trigger as one CR 603.3b batch, the
// search can name a decider for it, and the answer lands both on the stack, so a
// playout reaches both pumps. The ability is the same script the printed keyword
// prices.
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
import { enumerateMoves } from "../moves";
import { applyMoveInSearch, decidingPlayer } from "../search";
import { beginApplyingStaticEffects, resolveTopOfStack } from "../state";

const outcome = compileCard(
    oracleCard({
        name: "Riptide Lord",
        manaCost: "{2}{U}{R}",
        typeLine: "Creature — Otter Rogue",
        power: "3",
        toughness: "3",
        oracleText: "Other creatures you control have prowess.",
    })
);
if (outcome.state !== "ready") throw new Error(JSON.stringify(outcome));
const LORD = "test-prowess-bot-lord";
registerTokenDefinition({
    ...outcome.definition,
    id: LORD,
    rarity: "common",
} as CardDefinition);

describe("a granted prowess in the search (CR 702.108b, CR 603.3b)", () => {
    it("a noncreature cast batches both triggers and the answer reaches the pumps", () => {
        const swiftspear = makeInstance(
            getCardByName("Monastery Swiftspear").id,
            { id: "s", controllerId: "p1", ownerId: "p1" }
        );
        const lord = makeInstance(LORD, {
            id: "l",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ritual = makeInstance(getCardByName("Dark Ritual").id, {
            id: "r",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer("p1", {
                    battlefield: [lord, swiftspear],
                    hand: [ritual],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, lord);

        const cast = enumerateMoves(state, "p1").find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "r"
        );
        expect(cast).toBeDefined();
        applyMoveInSearch(state, "p1", cast!);

        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("trigger-order");
        expect(decidingPlayer(state)).toBe("p1");
        const [answer] = choiceCandidates(state, choice!);
        applyMoveInSearch(state, "p1", answer.move);
        expect(state.stack).toHaveLength(3);
        while (state.stack.length > 1) resolveTopOfStack(state);
        const pumped = state.players[0].battlefield.find((c) => c.id === "s")!;
        expect(getEffectivePower(state, pumped)).toBe(3);
    });
});
