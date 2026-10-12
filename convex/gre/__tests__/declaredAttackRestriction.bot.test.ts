// Bot enumeration of set-dependent attack restrictions (CR 508.1c, issue
// #5495). Scarred Puma "can't attack unless a black or green creature also
// attacks" is judged over the WHOLE declaration, so `enumerateAttackerMoves`
// must prune the subsets `confirmAttackers` throws on — the bot submitting one
// froze a live game.

import { describe, it, expect } from "vitest";
import { enumerateAttackerMoves } from "../moves";
import { validateDeclaredAttackers } from "../combat";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { scarredPuma } from "../../cards/sets/inv/red.cards";
import { grayOgre } from "../../cards/sets/lea/red.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import type { GameState } from "../state";

function declareAttackersState(companionCardId: string): GameState {
    const mine = (cardId: string, id: string) =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    mine(scarredPuma().id, "puma"),
                    mine(companionCardId, "other"),
                ],
            }),
            makePlayer("p2"),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function declarations(state: GameState): string[][] {
    return enumerateAttackerMoves(state, state.players[0]).flatMap((m) =>
        m.kind === "declare-attackers" ? [[...m.attackerIds].sort()] : []
    );
}

describe("declared-attack restrictions in the Bot's attacker enumeration (CR 508.1c)", () => {
    it("never offers Scarred Puma without a black or green co-attacker", () => {
        const state = declareAttackersState(grayOgre().id);
        const offered = declarations(state);
        expect(offered).toContainEqual(["other"]);
        expect(offered).toContainEqual([]);
        expect(offered.some((ids) => ids.includes("puma"))).toBe(false);
    });

    it("offers Scarred Puma alongside a green attacker", () => {
        const state = declareAttackersState(grizzlyBears().id);
        expect(declarations(state)).toContainEqual(["other", "puma"].sort());
    });

    it("reads the co-attacker's layer-5 colour, not its printed cost (CR 613.1e)", () => {
        const state = declareAttackersState(grayOgre().id);
        state.players[0].battlefield[1].grantedColors = [
            { color: "B", sourceId: "crusade" },
        ];
        expect(declarations(state)).toContainEqual(["other", "puma"].sort());
    });

    it("every enumerated declaration passes the confirm-time validator", () => {
        for (const companion of [grayOgre().id, grizzlyBears().id]) {
            const state = declareAttackersState(companion);
            for (const ids of declarations(state)) {
                state.combat!.attackerIds = ids;
                expect(validateDeclaredAttackers(state)).toEqual({ ok: true });
            }
        }
    });
});
