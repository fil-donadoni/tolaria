// CR 614.12 (issue #10980) — a permanent's persistent as-enters choice gets its
// own green line in the Live text, directly under the Oracle paragraph that
// asks for it. Real `buildPreviewBody` into the real face component, so a line
// dropped between the body and the render reds here.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { getCardByName } from "@convex/cards";
import { makeInstance } from "@convex/cards/__tests__/setup.helper";
import { buildPreviewBody } from "~/lib/preview-body";
import CardPreviewFace from "../card-preview-face";
import type { CardInstance } from "~/types/game";

function renderCavern(chosenSubtypes?: string[]) {
    const def = getCardByName("Cavern of Souls");
    const instance = makeInstance(def.id, {
        id: "cavern",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        ...(chosenSubtypes ? { chosenSubtypes } : {}),
    }) as unknown as CardInstance;
    const body = buildPreviewBody(def.id, instance, {
        allPlayers: [],
        playerId: "p1",
    });
    return render(<CardPreviewFace {...body} size="md" />);
}

describe("CardPreviewFace — as-enters choice line (CR 614.12)", () => {
    beforeEach(() => cleanup());

    it("renders the line with the success token, right after its anchor paragraph", () => {
        const { container } = renderCavern(["Elf"]);
        const line = container.querySelector("[data-choice-line]");
        expect(line).not.toBeNull();
        expect(line!.textContent).toBe("Chosen type: Elf");
        expect(line!.className).toContain("text-success-strong");
        // The line sits inside the anchor paragraph's block, after its text.
        const block = line!.parentElement!;
        expect(block.textContent).toBe(
            "As this land enters, choose a creature type.Chosen type: Elf"
        );
        expect(block.lastElementChild).toBe(line);
    });

    it("renders no line while nothing is chosen", () => {
        const { container } = renderCavern();
        expect(container.querySelector("[data-choice-line]")).toBeNull();
    });
});
