// Live ability-word count chips in the card-preview oracle text (issue #5491).
// OracleParagraph splices a chip after each count-based ability word the
// counter table names — success tones once met — so the player reads the
// conditional clause's on/off state.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import OracleParagraph from "../oracle-paragraph";
import type { AbilityWordCounter } from "~/lib/ability-word-counters";

function counters(
    entries: Record<string, AbilityWordCounter>
): Map<string, AbilityWordCounter> {
    return new Map(Object.entries(entries));
}

describe("OracleParagraph ability-word chips (CR 207.2c)", () => {
    beforeEach(() => cleanup());

    it("renders no chip without counters (deck builder / no game)", () => {
        const { container } = render(
            <OracleParagraph
                text="Delirium — deals 6 damage instead."
                counters={null}
            />
        );
        expect(container.querySelector("[data-ability-word]")).toBeNull();
    });

    it("shows an unmet delirium chip right after the word (3/4)", () => {
        const { container } = render(
            <OracleParagraph
                text="Delirium — deals 6 damage instead."
                counters={counters({
                    Delirium: {
                        key: "delirium",
                        chipId: "delirium",
                        have: 3,
                        goal: { atLeast: 4 },
                        met: false,
                    },
                })}
            />
        );
        const chip = container.querySelector<HTMLElement>(
            '[data-ability-word="delirium"]'
        );
        expect(chip!.textContent).toBe("3/4");
        expect(chip!.dataset.met).toBe("false");
        expect(chip!.previousSibling?.textContent).toBe("Delirium");
    });

    it("turns a met threshold chip success-strong (7/7)", () => {
        const { container } = render(
            <OracleParagraph
                text="Threshold — Add {B}{B} instead."
                counters={counters({
                    Threshold: {
                        key: "threshold",
                        chipId: "threshold",
                        have: 7,
                        goal: { atLeast: 7 },
                        met: true,
                    },
                })}
            />
        );
        const chip = container.querySelector<HTMLElement>(
            '[data-ability-word="threshold"]'
        );
        expect(chip!.textContent).toBe("7/7");
        expect(chip!.className).toContain("text-success-strong");
    });

    it("shows an uncapped devotion count bare, with no met state", () => {
        const { container } = render(
            <OracleParagraph
                text="X is your devotion to blue."
                counters={counters({
                    "devotion to blue": {
                        key: "devotion",
                        chipId: "devotion to blue",
                        have: 4,
                        met: null,
                    },
                })}
            />
        );
        const chip = container.querySelector<HTMLElement>(
            '[data-ability-word="devotion"]'
        );
        expect(chip!.textContent).toBe("4");
        expect(chip!.dataset.met).toBeUndefined();
    });

    it("chips a Domain paragraph once, after the word, not again on its phrase", () => {
        const domain: AbilityWordCounter = {
            key: "domain",
            chipId: "domain",
            have: 3,
            goal: { cap: 5 },
            met: false,
        };
        const { container } = render(
            <OracleParagraph
                text="Domain — X is the number of basic land types among lands you control."
                counters={counters({
                    Domain: domain,
                    "basic land types among lands you control": domain,
                })}
            />
        );
        const chips = container.querySelectorAll(
            '[data-ability-word="domain"]'
        );
        expect(chips).toHaveLength(1);
        expect(chips[0].textContent).toBe("3/5");
    });

    it("chips each devotion colour of one paragraph separately", () => {
        const { container } = render(
            <OracleParagraph
                text="If your devotion to blue is greater than your devotion to red, draw."
                counters={counters({
                    "devotion to blue": {
                        key: "devotion",
                        chipId: "devotion to blue",
                        have: 2,
                        met: null,
                    },
                    "devotion to red": {
                        key: "devotion",
                        chipId: "devotion to red",
                        have: 1,
                        met: null,
                    },
                })}
            />
        );
        const chips = container.querySelectorAll(
            '[data-ability-word="devotion"]'
        );
        expect([...chips].map((c) => c.textContent)).toEqual(["2", "1"]);
    });
});
