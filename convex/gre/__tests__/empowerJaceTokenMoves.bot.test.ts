// Bot reachability of the Jace planeswalker token (CR 701.71a, issue #7198):
// the move enumerator offers the token's loyalty abilities through the one
// CR 606 authority (`gre/loyalty.ts`), and refuses the −3 the token cannot
// pay (CR 606.6) — the same predicate the mutation path throws on.

import { describe, it, expect } from "vitest";
import { empowerJaceOps } from "../../cards/abilities/empowerJace";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import { enumerateMoves } from "../moves";
import { refreshExpectedInput } from "../expectedInput";
import { resolveTopOfStack, type GameState } from "../state";

/** Ancestral Recall's id, borrowed as the sorcery that carries the script. */
const ANCESTRAL_RECALL = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b";

/** p1 controls a Jace planeswalker token with `loyalty` counters, made by a
 *  real "Empower Jace N" resolution, holding priority in their main phase. */
function boardWithJaceToken(loyalty: number): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: [makeInstance(ANCESTRAL_RECALL, { zone: "library" })],
            }),
            makePlayer("p2"),
        ],
    });
    withTemporaryDefinition(
        {
            ...getDefinition(ANCESTRAL_RECALL),
            types: ["Sorcery"],
            targetRequirement: undefined,
            effects: empowerJaceOps(loyalty),
        },
        () => {
            pushSpell(state, ANCESTRAL_RECALL, "p1");
            resolveTopOfStack(state);
        }
    );
    state.priorityPlayerId = "p1";
    refreshExpectedInput(state);
    return state;
}

function activatedAbilityIds(state: GameState): string[] {
    return enumerateMoves(state, "p1")
        .filter((m) => m.kind === "activate-ability")
        .map((m) => (m as { abilityId: string }).abilityId);
}

describe("Jace planeswalker token — enumerateMoves (CR 606, CR 701.71a)", () => {
    it("offers both loyalty abilities when the token can pay them", () => {
        const ids = activatedAbilityIds(boardWithJaceToken(3));
        expect(ids).toContain("jace-token-surveil");
        expect(ids).toContain("jace-token-draw");
    });

    it("withholds the −3 at 2 loyalty (CR 606.6), keeps the −1", () => {
        const ids = activatedAbilityIds(boardWithJaceToken(2));
        expect(ids).toContain("jace-token-surveil");
        expect(ids).not.toContain("jace-token-draw");
    });
});
