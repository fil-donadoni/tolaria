// "Discard the last card you drew this turn" paid on a TARGETED activation
// (CR 118.3, CR 602.2b) — the immediate-commit path of
// `finalizeTargetSelection` must pay it exactly as the deferred path
// (`commitPendingActivation`, `discardLastDrawnSource`) and the untargeted
// path do. No shipped targeted card declares the cost, so a synthetic
// definition drives the REAL commit path.

import { describe, it, expect } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { withTemporaryDefinition } from "../../cards/registry";
import type { PendingTarget } from "../state";
import { drawCard } from "../state";
import { finalizeTargetSelection } from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const RING_ID = "test-targeted-discard-last-drawn";
const ABILITY_ID = "test-targeted-discard-last-drawn-ability";

const ring: CardDefinition = {
    id: RING_ID,
    name: "Test Targeted Discard Ring",
    rarity: "rare",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: ABILITY_ID,
            cost: { discardLastDrawn: true },
            useStack: true,
            oracleText:
                "Discard the last card you drew this turn: Target player gains 1 life.",
            targetRequirement: { type: "player", count: 1 },
            effects: [{ op: "gainLife", amount: 1 }],
        },
    ],
} as unknown as CardDefinition;

describe("targeted activation pays discardLastDrawn on the immediate commit (CR 118.3)", () => {
    it("discards the last drawn card and puts the ability on the stack", () => {
        withTemporaryDefinition(ring, () => {
            const p1 = makePlayer("p1", {
                battlefield: [
                    makeInstance(RING_ID, {
                        id: "ring",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                library: [
                    makeInstance(RING_ID, { id: "lib-0", zone: "library" }),
                ],
            });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            const drawn = drawCard(p1)!;
            expect(p1.hand.map((c) => c.id)).toEqual([drawn.id]);

            const pt: PendingTarget = {
                playerId: "p1",
                cardInstanceId: "ring",
                kind: "ability",
                abilityId: ABILITY_ID,
                targetType: "player",
                count: 1,
                selected: [{ type: "player", id: "p1" }],
            };
            finalizeTargetSelection(state, pt, "p1");

            expect(state.stack).toHaveLength(1);
            expect(p1.hand).toHaveLength(0);
            expect(p1.graveyard.map((c) => c.id)).toEqual([drawn.id]);
        });
    });
});
