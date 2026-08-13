// CR 603.3c (issue #2461) — the BOT half of modal triggered abilities. Two
// distinct obligations, and the engine freezes on either one alone:
//   1. Announcing a mode must be an ENUMERABLE move. A `PendingChoice` kind the
//      move generator doesn't know is a dead end — the bot is owed input it
//      cannot produce and the game stalls (ADR 0047 / #2283).
//   2. The value model must see the mode's own script. Before this issue the
//      catalogue's one modal trigger carried a hand-written `aiEffects` shadow
//      sketch of a single arm; a real mode list must be valued at its best arm
//      with no sketch at all.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { deceiverExarch } from "../../cards/sets/nph/blue";
import { grizzlyBears } from "../../cards/sets/lea/green";
import type { GameState, StackItem } from "../state";
import { raiseTriggerTargetSelection } from "../rules";
import { enumerateMoves } from "../moves";
import { decidingPlayer } from "../search";
import { choiceCandidates } from "../ai/choiceCandidates";
import { dslRealizedAbilityScriptValue } from "../ai/cardScriptValue";

function boardWithExarchTrigger(): { state: GameState; trig: StackItem } {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "mine",
                        controllerId: "p1",
                        ownerId: "p1",
                        isTapped: true,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "theirs",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const trig: StackItem = {
        id: "exarch-trig",
        card: { id: deceiverExarch.id },
        controllerId: "p1",
        ownerId: "p1",
        castById: "p1",
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        triggeredAbilityId: "deceiver-exarch-etb",
        triggerSourceId: "exarch",
    };
    state.stack.push(trig);
    raiseTriggerTargetSelection(state);
    return { state, trig };
}

describe("modal trigger mode announcement is a bot decision node (CR 603.3c)", () => {
    it("the owed announcement belongs to the controller and enumerates one move per choosable mode", () => {
        const { state } = boardWithExarchTrigger();
        expect(state.pendingChoices?.[0].kind).toBe("trigger-mode");
        expect(decidingPlayer(state)).toBe("p1");

        const moves = enumerateMoves(state, "p1");
        const picks = moves
            .filter((m) => m.kind === "resolution-choice")
            .map((m) =>
                m.kind === "resolution-choice" ? m.cardInstanceIds[0] : null
            );
        expect(picks).toEqual(["untap-yours", "tap-theirs"]);
    });

    it("is registered as an in-tree candidate generator with stable per-mode keys", () => {
        const { state } = boardWithExarchTrigger();
        const candidates = choiceCandidates(state, state.pendingChoices![0]);
        expect(candidates.map((c) => c.key)).toEqual([
            "trigger-mode:untap-yours",
            "trigger-mode:tap-theirs",
        ]);
        // Keys are derived from the card DEFINITION's mode ids, so they are
        // stable across determinizations (no per-world instance id in them).
        const second = choiceCandidates(state, state.pendingChoices![0]);
        expect(second.map((c) => c.key)).toEqual(candidates.map((c) => c.key));
    });
});

describe("modal trigger valuation walks the mode scripts, not a shadow sketch (PRD #1423)", () => {
    it("Deceiver Exarch's ability worth comes from its modes with no aiEffects", () => {
        // The card carries NO ability-level `effects[]` and no `aiEffects`
        // shadow — its whole body is the two modes. If the ability-script
        // reader ignored `modes`, this would be 0 and the bot would price the
        // Exarch as a vanilla 1/4.
        const etb = deceiverExarch.triggeredAbilities![0];
        expect(etb.effects).toBeUndefined();
        expect(etb.aiEffects).toBeUndefined();
        expect(etb.modes).toHaveLength(2);
        expect(dslRealizedAbilityScriptValue(deceiverExarch)).toBeGreaterThan(
            0
        );
    });
});
