/**
 * Issue #9551 — the live Brain's view of a hand-sought name window (Cabal
 * Therapy: "Target player reveals their hand and discards all cards with that
 * name", CR 701.20a / 701.9), through the REAL projection: the window is a
 * search node, and the no-worker default names a card the bot knows is in
 * that hand rather than a registry-order name.
 */

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { buildBladeState, findBladeScenario } from "@convex/gre/ai/blade";
import { seatPlayerId } from "@convex/gre/ai/blade/matcher";
import { buildBotView } from "../bot-view";

const REVEALED =
    "Hand-sought name: Cabal Therapy names a card from the hand a reveal showed";
const DECKLIST =
    "Hand-sought name: Cabal Therapy names a nonland card of the known decklist";

function viewOf(label: string) {
    const entry = findBladeScenario(label);
    if (!entry) throw new Error(`No blade entry "${label}"`);
    const state = buildBladeState(entry);
    const bot = seatPlayerId(state, "me");
    return buildBotView(projectPublicState(state, 1, bot), bot).owedChoice;
}

describe("hand-sought name window in the bot view (issue #9551)", () => {
    it("is a search node on the projected state", () => {
        expect(viewOf(REVEALED)?.searchable).toBe(true);
    });

    it("defaults to a nonland card the reveal showed in the target's hand", () => {
        expect(["Counterspell", "Lightning Bolt"]).toContain(
            viewOf(REVEALED)?.nameCardDefault
        );
    });

    it("never reads an unrevealed hand: the default is not the hidden card", () => {
        expect(viewOf(DECKLIST)?.nameCardDefault).not.toBe("Lightning Bolt");
    });
});
