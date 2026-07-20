// Live delirium/threshold progress chips in the card-preview oracle text.
// OracleParagraph splices a `have/need` chip after each graveyard ability word,
// emerald once met — so the player reads the conditional clause's on/off state.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import OracleParagraph from "../oracle-paragraph";
import { computeGraveyardMilestones } from "~/lib/graveyard-milestones";
import type { CardInstance } from "~/types/game";

function gy(types: string[]): CardInstance {
    return {
        id: `c-${Math.random()}`,
        card: { id: "x" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        types,
        isTapped: false,
    } as CardInstance;
}

describe("OracleParagraph milestone chips (CR 702.D / 702.T)", () => {
    beforeEach(() => cleanup());

    it("renders no chip without milestones (deck builder / no game)", () => {
        const { container } = render(
            <OracleParagraph
                text="Delirium — deals 6 damage instead."
                milestones={null}
            />
        );
        expect(container.querySelector("[data-milestone]")).toBeNull();
    });

    it("shows an in-progress delirium chip (3/4, not met)", () => {
        const milestones = computeGraveyardMilestones([
            gy(["Creature"]),
            gy(["Land"]),
            gy(["Sorcery"]),
        ]);
        const { container } = render(
            <OracleParagraph
                text="Delirium — deals 6 damage instead."
                milestones={milestones}
            />
        );
        const chip = container.querySelector<HTMLElement>(
            '[data-milestone="delirium"]'
        );
        expect(chip).not.toBeNull();
        expect(chip!.textContent).toBe("3/4");
        expect(chip!.dataset.met).toBe("false");
    });

    it("shows a met threshold chip turned success-strong (7/7)", () => {
        const milestones = computeGraveyardMilestones(
            Array.from({ length: 7 }, () => gy(["Creature"]))
        );
        const { container } = render(
            <OracleParagraph
                text="Threshold — Add {B}{B} instead."
                milestones={milestones}
            />
        );
        const chip = container.querySelector<HTMLElement>(
            '[data-milestone="threshold"]'
        );
        expect(chip!.textContent).toBe("7/7");
        expect(chip!.dataset.met).toBe("true");
        expect(chip!.className).toContain("text-success-strong");
    });
});
