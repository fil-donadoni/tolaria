// Per-card behaviour tests for APC colourless cards
// (`convex/cards/sets/apc/colorless.ts`).
//
// Dragon Arch is a hand-tail card (issue #3806) built entirely out of
// already-exercised Ops, so the per-Op regime owes it nothing. What it DOES
// owe is the one card-level claim no Op test makes: the activated ability's
// candidate list is the MULTICOLOURED creatures in hand and nothing else
// (CR 105.2b). Both wrong readings fail silently at the table — an OR over
// the five colours puts a mono-coloured creature into play, and a dropped
// `type` puts a gold non-creature there.
//
// Resolved through the REGISTRY SEAM by id, never by name.
import { describe, expect, it } from "vitest";
import { getDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

const DRAGON_ARCH = getDefinition("eec581b8-e509-420c-b142-afaa6dd06cc8");
/** Angus Mackenzie — {G}{W}{U}, three of the five colours (CR 105.2b). */
const GOLD_CREATURE = getDefinition("57264bd9-94f6-4d4d-baff-2b2900585635");
/** Grizzly Bears — {1}{G}, monocoloured (CR 105.2a). */
const MONO_CREATURE = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
/** Ornithopter — no coloured pip at all (CR 105.2c). */
const COLORLESS_CREATURE = getDefinition(
    "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0"
);
/** Vindicate — {1}{W}{B}: multicoloured, and NOT a creature. */
const GOLD_NONCREATURE = getDefinition("2a1bfefd-dae8-49e9-9d56-cc852e3dc93b");

/** p1 controls Dragon Arch and holds `hand` (by definition id). */
function board(handIds: string[]): {
    state: GameState;
    arch: CardInstanceState;
} {
    const arch = makeInstance(DRAGON_ARCH.id, {
        id: "arch",
        controllerId: "p1",
        ownerId: "p1",
    });
    const hand = handIds.map((defId, i) =>
        makeInstance(defId, {
            id: `h${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [arch], hand }),
            makePlayer("p2"),
        ],
    });
    return { state, arch };
}

/** Pushes Dragon Arch's activated ability onto the stack and resolves it —
 *  the REAL ability (cost, `useStack`), not a hand-built script. */
function activate(state: GameState, source: CardInstanceState): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId: "dragon-arch-put",
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Dragon Arch — {2}, {T}: put a multicolored creature from hand onto the battlefield (CR 105.2b / 400.7, issue #3806)", () => {
    it("offers ONLY the multicoloured creature, and putting it in play is a zone change, not a cast", () => {
        const { state, arch } = board([
            GOLD_CREATURE.id,
            MONO_CREATURE.id,
            COLORLESS_CREATURE.id,
            GOLD_NONCREATURE.id,
        ]);
        activate(state, arch);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        // h0 alone: the mono-coloured creature is the OR-over-five misparse,
        // the colourless one is CR 105.2c, the gold sorcery is a dropped
        // `type`.
        expect(head.candidateIds).toEqual(["h0"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0"],
        });
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "arch",
            "h0",
        ]);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "h1",
            "h2",
            "h3",
        ]);
        // Nothing was CAST (CR 601.1) — the stack is empty after the ability
        // resolved, with no creature spell on it.
        expect(state.stack).toHaveLength(0);
    });

    it('is a "you may" — declining puts nothing onto the battlefield', () => {
        const { state, arch } = board([GOLD_CREATURE.id]);
        activate(state, arch);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["arch"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["h0"]);
    });

    it("does nothing with no multicoloured creature in hand (CR 608.2b)", () => {
        const { state, arch } = board([MONO_CREATURE.id]);
        expect(() => activate(state, arch)).not.toThrow();
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["arch"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["h0"]);
    });
});
