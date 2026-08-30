// CR 118.8 / 608.2h — the search sandboxes and the CAST-side sacrifice
// additional cost.
//
// The cast-side twin of `exileCostSnapshotInSearch.bot.test.ts`. Both search
// sandboxes already PAID the additional sacrifice (`applyCastCostPicksForSearch`
// removes the victim), but neither recorded WHICH permanent left, so the
// pushed stack item carried no `additionalSacrificeSnapshot` and
// `SpellContext.getAdditionalSacrificeMv()` answered `undefined` at resolve.
// Metamorphosis ("Add X mana of any one color, where X is 1 plus the
// sacrificed creature's mana value") then early-returned: inside the tree the
// spell sacrificed a creature, spent a card and produced NOTHING. The bot
// could never find the ritual line, and — since a wholly worthless cast still
// ties `pass` once the rollout washes the material out — could still pick it.
//
// The mutation path takes this snapshot in `sacrificeSnapshotFromSelection`
// (`game.ts`); `applyCastSacrificeVictims` (`castCostPicks.ts`) is the
// sandboxes' single shared authority for it, so the tree and live play cannot
// drift on which victim is snapshot-flagged.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { cloneGameState } from "../clone";
import { checkStateBasedActions } from "../sba";
import { resolveTopOfStack, type GameState } from "../state";

/** Grizzly Bears is {1}{G} — mana value 2, so Metamorphosis makes 1 + 2 = 3. */
const EXPECTED_MANA = 3;

function board(): GameState {
    const scenario: BladeScenario = {
        label: "cast-sacrifice-snapshot-unit",
        spec: {
            cards: [
                { name: "Metamorphosis", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    };
    return buildBladeState(scenario);
}

function castMove(state: GameState, playerId: string): Move {
    const move = enumerateMoves(state, playerId).find(
        (m) => m.kind === "cast-spell"
    );
    if (!move) throw new Error("no Metamorphosis cast was enumerated");
    return move;
}

/** Resolve whatever the sandbox left on the stack, the way the tree does. */
function settle(state: GameState): void {
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 8) {
        resolveTopOfStack(state);
        checkStateBasedActions(state);
    }
}

describe("cast-side additional-sacrifice snapshot in the search sandboxes", () => {
    it("the ISMCTS sandbox stamps the victim's mana value onto the stack item", () => {
        const state = board();
        const me = state.players[0].id;
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, me, castMove(state, me));

        const item = probe.stack[probe.stack.length - 1];
        expect(item?.additionalSacrificeSnapshot?.mv).toBe(2);
        expect(
            probe.players
                .find((p) => p.id === me)
                ?.graveyard.some((c) => c.types.includes("Creature"))
        ).toBe(true);
    });

    it("the ISMCTS sandbox resolves Metamorphosis into 1 + the victim's mana value, restricted", () => {
        const state = board();
        const me = state.players[0].id;
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, me, castMove(state, me));
        settle(probe);

        const restricted =
            probe.players.find((p) => p.id === me)?.restrictedMana ?? [];
        expect(restricted).toHaveLength(1);
        expect(restricted[0].amount).toBe(EXPECTED_MANA);
        // CR 106.6 — the mana is spendable only on creature spells.
        expect(restricted[0].restriction).toBe("creature-spell");
    });

    it("the greedy 1-ply sandbox produces the SAME mana — a cost charged in one tree and not the other is a divergence", () => {
        const state = board();
        const me = state.players[0].id;
        const after = applyMoveForSearch(state, me, castMove(state, me));

        const restricted =
            after.players.find((p) => p.id === me)?.restrictedMana ?? [];
        expect(restricted).toHaveLength(1);
        expect(restricted[0].amount).toBe(EXPECTED_MANA);
        expect(restricted[0].restriction).toBe("creature-spell");
    });
});
