// Bot-play sweep (ADR 0105 § 7.2) — a creature whose enters trigger is modal
// announces its mode as the trigger goes on the stack (CR 603.3c). The sweep's
// follow-through has to reach that choice with its stack item still there, or
// the play throws and the card ships as a `harness-error` Bot Gap.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";

describe("playBotReach on a modal enters trigger (CR 603.3c)", () => {
    it("plays Deceiver Exarch through its mode announcement", () => {
        const verdict = playBotReach(getCardByName("Deceiver Exarch")!);
        expect(verdict).toEqual({ outcome: "played" });
    });
});
