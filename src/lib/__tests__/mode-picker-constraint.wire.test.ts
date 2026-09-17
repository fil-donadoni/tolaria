// The mode picker's constraint (ADR 0094, issue #2264) is sized client-side
// BEFORE any mutation is called, from the same `ModeSelection` the server
// validates. Its board-reading inputs — the conditional count's "controls a
// Wizard" and each mode's CR 700.2a legality hint — must read the WIRE view,
// so every board here crosses `projectPublicState` and the legality view is
// built by the real `buildTriggerStateView` reducer.

import { describe, expect, it } from "vitest";
import type { ModeSelection, SpellMode } from "@convex/cards/types";
import type { GameState } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { grizzlyBears } from "@convex/cards/sets/lea/green";
import { prodigalSorcerer } from "@convex/cards/sets/lea/blue";
import { hullBreach } from "@convex/cards/sets/pls/multicolor";
import type { CardInstance, Player } from "~/types/game";
import { buildTriggerStateView } from "../card-utils";
import {
    canAddModePick,
    canConfirmModePicks,
    chosenModeIdsFromCounts,
    modeLegalityHint,
    modePickerConstraint,
    modePickerHeading,
    modePickerShortfallNote,
    viewerModeSelectionFacts,
} from "../mode-picker-constraint";

const PING: SpellMode = {
    id: "ping",
    label: "1 damage to target creature",
    oracleText: "This spell deals 1 damage to target creature.",
    targetRequirement: { type: "Creature", count: 1 },
};
const DRAW: SpellMode = { id: "draw", label: "Draw", oracleText: "Draw." };
const GAIN: SpellMode = { id: "gain", label: "Gain", oracleText: "Gain." };
const MODES = [PING, DRAW, GAIN];

function board(opts: { wizard?: boolean; creature?: boolean }): GameState {
    const spell = makeInstance(hullBreach.id, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const mine = opts.wizard
        ? [
              makeInstance(prodigalSorcerer.id, {
                  id: "wiz",
                  controllerId: "p1",
                  ownerId: "p1",
                  zone: "battlefield",
              }),
          ]
        : [];
    const theirs = opts.creature
        ? [
              makeInstance(grizzlyBears.id, {
                  id: "bears",
                  controllerId: "p2",
                  ownerId: "p2",
                  zone: "battlefield",
              }),
          ]
        : [];
    return makeState({
        players: [
            makePlayer("p1", { hand: [spell], battlefield: mine }),
            makePlayer("p2", { battlefield: theirs }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** The constraint exactly as `useHandCardCommit` builds it, from the wire. */
function constraintOnWire(
    state: GameState,
    selection: ModeSelection,
    kicked = false
) {
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const me = players.find((p) => p.id === "p1");
    const source = me!.hand.find((c) => c?.id === "spell") as CardInstance;
    return modePickerConstraint({
        modes: MODES,
        selection,
        facts: viewerModeSelectionFacts(me, kicked),
        isModeLegal: modeLegalityHint(
            source,
            buildTriggerStateView(players, projected.activePlayerId)
        ),
    });
}

describe("mode picker constraint — declared count (CR 700.2a / 700.2d)", () => {
    it("a fixed count reads 'Choose three' and gates Confirm on it", () => {
        const c = constraintOnWire(board({ creature: true }), {
            min: 3,
            max: 3,
            repeats: true,
        });
        expect(modePickerHeading(c)).toBe("Choose three");
        expect(canConfirmModePicks(c, { ping: 2 })).toBe(false);
        expect(canConfirmModePicks(c, { ping: 2, draw: 1 })).toBe(true);
        // Repeats: the same mode keeps accepting picks until the count is met.
        expect(canAddModePick(c, { ping: 2 }, "ping")).toBe(true);
        expect(canAddModePick(c, { ping: 3 }, "ping")).toBe(false);
    });

    it("a distinct-modes range reads 'Choose 1–2' and refuses a repeat", () => {
        const c = constraintOnWire(board({ creature: true }), {
            min: 1,
            max: 2,
        });
        expect(modePickerHeading(c)).toBe("Choose 1–2");
        expect(canAddModePick(c, { draw: 1 }, "draw")).toBe(false);
        expect(canAddModePick(c, { draw: 1 }, "gain")).toBe(true);
        expect(canConfirmModePicks(c, { draw: 1 })).toBe(true);
    });

    it("the announced ids come out in printed order, repeats consecutive (CR 700.2d)", () => {
        expect(chosenModeIdsFromCounts(MODES, { gain: 1, ping: 2 })).toEqual([
            "ping",
            "ping",
            "gain",
        ]);
    });
});

describe("mode picker constraint — conditional count, evaluated client-side", () => {
    const flameShape: ModeSelection = {
        min: 1,
        max: 1,
        when: {
            condition: { controls: { subtypes: ["Wizard"] } },
            min: 1,
            max: 2,
        },
    };

    it("controlling a Wizard on the wire board raises the count before any mutation", () => {
        expect(constraintOnWire(board({}), flameShape).max).toBe(1);
        expect(constraintOnWire(board({ wizard: true }), flameShape).max).toBe(
            2
        );
    });

    it("the kicker decision already made feeds a kicked count (CR 601.4)", () => {
        const kickedShape: ModeSelection = {
            min: 1,
            max: 1,
            when: { condition: { kicked: true }, min: 2, max: 2 },
        };
        expect(constraintOnWire(board({}), kickedShape, false).max).toBe(1);
        expect(constraintOnWire(board({}), kickedShape, true).min).toBe(2);
    });
});

describe("mode picker constraint — CR 609.3 shortfall", () => {
    it("with no creature to target, 'Choose three' distinct confirms with the two legal modes", () => {
        const c = constraintOnWire(board({}), { min: 3, max: 3 });
        expect(c.legalModeIds).toEqual(["draw", "gain"]);
        expect(c.shortfall).toBe(true);
        expect(c.requiredCount).toBe(2);
        expect(canAddModePick(c, {}, "ping")).toBe(false);
        expect(canConfirmModePicks(c, { draw: 1, gain: 1 })).toBe(true);
        expect(modePickerShortfallNote(c)).toMatch(/Only 2 modes/);
    });

    it("with every mode needing an absent target, says so instead of dead-ending", () => {
        const c = modePickerConstraint({
            modes: [PING],
            selection: { min: 1, max: 1 },
            facts: viewerModeSelectionFacts(undefined, false),
            isModeLegal: () => false,
        });
        expect(c.legalModeIds).toEqual([]);
        expect(canConfirmModePicks(c, {})).toBe(false);
        expect(modePickerShortfallNote(c)).toMatch(/No mode can be chosen/);
    });

    it("no shortfall once the creature is on the board", () => {
        const c = constraintOnWire(board({ creature: true }), {
            min: 3,
            max: 3,
        });
        expect(c.shortfall).toBe(false);
        expect(canConfirmModePicks(c, { draw: 1, gain: 1 })).toBe(false);
    });
});
