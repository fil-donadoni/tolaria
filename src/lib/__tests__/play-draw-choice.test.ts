import { describe, it, expect } from "vitest";
import { interstitialChoiceState } from "../play-draw-choice";

// Play/draw interstitial UI state (#394, CR 103.4). The pure resolver decides
// whether the viewer is prompted, the choice auto-resolves (bot), or the viewer
// waits on the opponent.

type Meta = Parameters<typeof interstitialChoiceState>[0];

const meta = (overrides: Partial<Meta>): Meta => ({
    playDrawChooserId: undefined,
    vsAi: false,
    solo: false,
    ...overrides,
});

describe("interstitialChoiceState (#394)", () => {
    it("prompts the viewer when they are the chooser (2-player)", () => {
        const s = interstitialChoiceState(
            meta({ playDrawChooserId: "u1" }),
            "u1"
        );
        expect(s.kind).toBe("prompt");
    });

    it("waits when the opponent (other human) is the chooser", () => {
        const s = interstitialChoiceState(
            meta({ playDrawChooserId: "u2" }),
            "u1"
        );
        expect(s.kind).toBe("waiting");
    });

    it("auto-continues when the bot is the chooser (vs-AI)", () => {
        const s = interstitialChoiceState(
            meta({ playDrawChooserId: "u1-p2", vsAi: true, solo: true }),
            "u1"
        );
        expect(s.kind).toBe("auto");
    });

    it("prompts the human when they are the chooser in vs-AI", () => {
        const s = interstitialChoiceState(
            meta({ playDrawChooserId: "u1-p1", vsAi: true, solo: true }),
            "u1"
        );
        expect(s.kind).toBe("prompt");
    });

    it("prompts in non-AI solo regardless of which seat chooses", () => {
        // The single user controls both seats and always makes the choice.
        const a = interstitialChoiceState(
            meta({ playDrawChooserId: "u1-p1", solo: true }),
            "u1"
        );
        const b = interstitialChoiceState(
            meta({ playDrawChooserId: "u1-p2", solo: true }),
            "u1"
        );
        expect(a.kind).toBe("prompt");
        expect(b.kind).toBe("prompt");
    });

    it("auto-continues when no chooser is recorded (legacy fallback)", () => {
        const s = interstitialChoiceState(meta({}), "u1");
        expect(s.kind).toBe("auto");
    });
});
