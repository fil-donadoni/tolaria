// Bot-play sweep (issue #4821) — a card that targets a SPELL is posed against
// a stacked object its requirement can name (CR 115.1, CR 601.2c). Before, the
// opponent's one plain creature spell was the only stack, so every narrowed
// counterspell read `position-unmodelled`: the engine refused a human the cast
// too. Each verdict goes through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReach } from "../botReach";
import { stackPose } from "../botReachStack";

describe("stackPose", () => {
    it("stacks a noncreature spell for 'target noncreature spell' (CR 601.2c)", () => {
        const pose = stackPose(getCardByName("Spell Pierce")!, "Island");
        expect(pose?.stack).toEqual([
            { kind: "spell", name: "Castle", controller: "opp" },
        ]);
    });

    it("stacks an artifact or enchantment spell for 'artifact or enchantment spell'", () => {
        const pose = stackPose(getCardByName("Annul")!, "Island");
        expect(pose?.stack[0]).toMatchObject({ kind: "spell", name: "Castle" });
    });

    it("stacks an ability, with its source on the opponent's battlefield (CR 113.1c)", () => {
        const pose = stackPose(getCardByName("Stifle")!, "Island");
        expect(pose?.stack[0]).toMatchObject({
            kind: "ability",
            controller: "opp",
        });
        expect(pose?.cards).toEqual([
            { name: "Prodigal Sorcerer", owner: "opp", zone: "battlefield" },
        ]);
    });

    it("stacks a spell aimed at the holder's land for 'targets a land you control'", () => {
        const pose = stackPose(getCardByName("Teferi's Response")!, "Island");
        expect(pose?.stack[0]).toMatchObject({
            kind: "spell",
            controller: "opp",
            targets: [{ kind: "permanent", name: "Island", seat: "me" }],
        });
    });

    it("keeps the plain creature spell for an unfiltered counterspell", () => {
        const pose = stackPose(getCardByName("Counterspell")!, "Island");
        expect(pose?.stack).toEqual([
            { kind: "spell", name: "Grizzly Bears", controller: "opp" },
        ]);
    });

    it("poses nothing for a card with no spell target", () => {
        expect(stackPose(getCardByName("Lightning Bolt")!, "Mountain")).toBe(
            undefined
        );
    });
});

describe("playBotReach on narrowed counterspells", () => {
    it.each(["Annul", "Force of Negation", "Spell Pierce", "Stifle"])(
        "%s is posed and played",
        (name) => {
            expect(playBotReach(getCardByName(name)!)).toEqual({
                outcome: "played",
            });
        }
    );

    it.each(["Bind", "Confound", "Fork"])(
        "%s is posed — never a harness refusal",
        (name) => {
            const verdict = playBotReach(getCardByName(name)!);
            expect(verdict.cause).not.toBe("position-unmodelled");
        }
    );

    it("Teferi's Response is posed — the Bot weighs it, never a harness refusal", () => {
        const verdict = playBotReach(getCardByName("Teferi's Response")!);
        expect(verdict.cause).not.toBe("position-unmodelled");
    });
});
