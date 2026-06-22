// Poison as a player-level resource (CR 122) and its loss SBA (CR 704.5c).
// Exercises every layer of the foundational poison seam (ADR 0032):
//   - addPoisonCounters primitive, end-to-end through resolveTopOfStack
//   - the >=10 loss SBA, routed through applyLoseGameReplacements (CR 614)
//   - the field crossing projectPublicState (wire format)
import { beforeAll, describe, expect, it } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { resolveTopOfStack } from "../state";
import { checkGameOverSBA } from "../sba";
import { projectPublicState } from "../../gameProjections";

// Synthetic instant: "Target player gets two poison counters." Lets us drive
// the real SpellContext.addPoisonCounters primitive through the engine without
// depending on a specific DRK card (which ships separately, #418).
const POISON_DART_ID = "test:poison-dart";
const poisonDart: CardDefinition = {
    id: POISON_DART_ID,
    name: "Test Poison Dart",
    rarity: "common",
    oracleText: "Target player gets two poison counters.",
    manaCost: { B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx) => {
        ctx.addPoisonCounters(ctx.targets[0].id, 2);
    },
};

// Synthetic permanent carrying a "you don't lose the game for poison"
// replacement — proves the poison loss is interceptable via CR 614, parity
// with Lich's life-zero clause.
const POISON_WARD_ID = "test:poison-ward";
const poisonWard: CardDefinition = {
    id: POISON_WARD_ID,
    name: "Test Poison Ward",
    rarity: "common",
    oracleText: "You don't lose the game for having ten or more poison.",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    replacementEffects: [
        {
            id: "poison-ward-no-lose",
            oracleText:
                "You don't lose the game for having ten or more poison.",
            eventKind: "lose-game",
            appliesTo: (event, self) => {
                if (event.kind !== "lose-game") return false;
                if (event.reason !== "poison") return false;
                return event.playerId === self.controllerId;
            },
            replace: () => ({ kind: "consumed" }),
        },
    ],
};

beforeAll(() => {
    registerTokenDefinition(poisonDart);
    registerTokenDefinition(poisonWard);
});

describe("addPoisonCounters primitive (CR 122 — counters on a player)", () => {
    it("adds poison counters to the targeted player", () => {
        const state = makeState();
        pushSpell(state, POISON_DART_ID, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].poisonCounters).toBe(2);
        // The other player is untouched.
        expect(state.players[0].poisonCounters).toBeUndefined();
    });

    it("accumulates across multiple additions (no cap below ten)", () => {
        const state = makeState();
        for (let i = 0; i < 3; i++) {
            pushSpell(state, POISON_DART_ID, "p1", [
                { type: "player", id: "p2" },
            ]);
            resolveTopOfStack(state);
        }
        expect(state.players[1].poisonCounters).toBe(6);
    });
});

describe("poison loss SBA (CR 704.5c — ten or more poison loses)", () => {
    it("a player with ten or more poison counters loses the game", () => {
        const state = makeState();
        state.players[1].poisonCounters = 10;
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver).toBeDefined();
        expect(state.gameOver?.reason).toBe("poison");
        expect(state.gameOver?.loserId).toBe("p2");
        expect(state.gameOver?.winnerId).toBe("p1");
    });

    it("does NOT lose at nine poison counters (threshold is ten)", () => {
        const state = makeState();
        state.players[1].poisonCounters = 9;
        expect(checkGameOverSBA(state)).toBe(false);
        expect(state.gameOver).toBeUndefined();
    });

    it("loses when poison exceeds ten (no cap on the field)", () => {
        const state = makeState();
        state.players[0].poisonCounters = 14;
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver?.reason).toBe("poison");
        expect(state.gameOver?.loserId).toBe("p1");
    });

    it("life-zero is reported before poison when both apply (loop order)", () => {
        // The loop checks life first; a player at <=0 life loses for "life"
        // even with lethal poison. Documents the same-player precedence.
        const state = makeState();
        state.players[1].life = 0;
        state.players[1].poisonCounters = 12;
        expect(checkGameOverSBA(state)).toBe(true);
        expect(state.gameOver?.reason).toBe("life");
    });
});

describe("poison loss is interceptable via CR 614 (loss-replacement parity)", () => {
    it("a 'you don't lose for poison' replacement consumes the loss", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { poisonCounters: 10 }),
                makePlayer("p2"),
            ],
        });
        // p1 controls the ward — its lose-game replacement should consume the
        // poison loss, exactly like Lich consumes the life-zero loss.
        state.players[0].battlefield.push(
            makeInstance(POISON_WARD_ID, {
                id: "ward",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        expect(checkGameOverSBA(state)).toBe(false);
        expect(state.gameOver).toBeUndefined();
    });
});

describe("poison crosses the wire (projectPublicState — ADR 0032)", () => {
    it("poisonCounters survives the public projection for both seats", () => {
        const state = makeState();
        state.players[1].poisonCounters = 8;
        // Fat-state assertion.
        expect(state.players[1].poisonCounters).toBe(8);
        // Same assertion after projection — the field rides the `...player`
        // spread (PublicPlayer = Omit<PlayerState, …zones>).
        const projected = projectPublicState(state, 1, "p1");
        const slimP2 = projected.players.find((p) => p.id === "p2")!;
        expect(slimP2.poisonCounters).toBe(8);
        const slimP1 = projected.players.find((p) => p.id === "p1")!;
        expect(slimP1.poisonCounters).toBeUndefined();
    });
});
