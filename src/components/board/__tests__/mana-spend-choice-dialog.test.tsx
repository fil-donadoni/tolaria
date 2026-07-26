// CR 601.2g (issue #1445) — ManaSpendChoiceDialog: the generic-mana spend
// picker rendered while a `manaSpendChoice` is parked on the viewer's
// pendingCast/pendingActivation. Verifies the mana-symbol SVG affordance
// (never colored circles with letters — project convention), the
// resolveManaSpendChoice submission shape, disable-while-pending, and the
// multi-point buffer for generic > 1.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const resolveManaSpendChoice = vi.fn();
const cancelCast = vi.fn();
const cancelActivation = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (fn: { name?: string }) => {
        // The mocked `api.game.*` object below carries a distinguishing
        // marker per mutation so one `useMutation` mock can route to the
        // right spy without depending on call order.
        const name = (fn as unknown as { __name: string }).__name;
        if (name === "resolveManaSpendChoice") return resolveManaSpendChoice;
        if (name === "cancelCast") return cancelCast;
        if (name === "cancelActivation") return cancelActivation;
        throw new Error(`unexpected mutation: ${name}`);
    },
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            resolveManaSpendChoice: { __name: "resolveManaSpendChoice" },
            cancelCast: { __name: "cancelCast" },
            cancelActivation: { __name: "cancelActivation" },
        },
    },
}));

import ManaSpendChoiceDialog from "../mana-spend-choice-dialog";

describe("ManaSpendChoiceDialog (CR 601.2g)", () => {
    beforeEach(() => {
        cleanup();
        resolveManaSpendChoice.mockReset().mockResolvedValue(undefined);
        cancelCast.mockReset().mockResolvedValue(undefined);
        cancelActivation.mockReset().mockResolvedValue(undefined);
    });

    it("renders every candidate color as a mana-symbol SVG (never a colored circle)", () => {
        render(
            <ManaSpendChoiceDialog
                choice={{ generic: 1, candidateColors: ["U", "G"] }}
                container="cast"
                gameId={"g" as never}
                playerId="p1"
            />
        );
        const u = screen.getByAltText("U") as HTMLImageElement;
        const g = screen.getByAltText("G") as HTMLImageElement;
        expect(u.tagName).toBe("IMG");
        expect(u.src).toContain("/img/symbols/U.svg");
        expect(g.src).toContain("/img/symbols/G.svg");
    });

    it("clicking a color submits resolveManaSpendChoice with that spend order (generic: 1)", async () => {
        render(
            <ManaSpendChoiceDialog
                choice={{ generic: 1, candidateColors: ["U", "G"] }}
                container="cast"
                gameId={"g" as never}
                playerId="p1"
            />
        );
        fireEvent.click(screen.getByAltText("U"));
        expect(resolveManaSpendChoice).toHaveBeenCalledWith({
            gameId: "g",
            playerId: "p1",
            spendOrder: ["U"],
        });
    });

    it("buffers picks until the spend order reaches `generic` entries (generic: 2)", () => {
        render(
            <ManaSpendChoiceDialog
                choice={{ generic: 2, candidateColors: ["W", "B"] }}
                container="cast"
                gameId={"g" as never}
                playerId="p1"
            />
        );
        fireEvent.click(screen.getByAltText("W"));
        // One pick short of `generic` — no submission yet.
        expect(resolveManaSpendChoice).not.toHaveBeenCalled();
        fireEvent.click(screen.getByAltText("B"));
        expect(resolveManaSpendChoice).toHaveBeenCalledWith({
            gameId: "g",
            playerId: "p1",
            spendOrder: ["W", "B"],
        });
    });

    it("disables the color buttons while the mutation is in flight", async () => {
        let resolvePromise: () => void = () => {};
        resolveManaSpendChoice.mockReturnValue(
            new Promise<void>((resolve) => {
                resolvePromise = resolve;
            })
        );
        render(
            <ManaSpendChoiceDialog
                choice={{ generic: 1, candidateColors: ["U", "G"] }}
                container="cast"
                gameId={"g" as never}
                playerId="p1"
            />
        );
        fireEvent.click(screen.getByAltText("U"));
        const uButton = screen
            .getByAltText("U")
            .closest("button")! as HTMLButtonElement;
        const gButton = screen
            .getByAltText("G")
            .closest("button")! as HTMLButtonElement;
        expect(uButton.disabled).toBe(true);
        expect(gButton.disabled).toBe(true);
        resolvePromise();
    });

    it("cancels the pendingActivation (not pendingCast) when container is 'activation'", async () => {
        render(
            <ManaSpendChoiceDialog
                choice={{ generic: 1, candidateColors: ["W"] }}
                container="activation"
                gameId={"g" as never}
                playerId="p1"
            />
        );
        // Dismiss via the dialog's own open-change handler (Escape key
        // routes through Radix's onOpenChange, exercised here directly via
        // the rendered dialog's overlay/backdrop click semantics is brittle
        // in jsdom — assert the wiring instead by invoking the escape key,
        // which Radix Dialog handles for us).
        fireEvent.keyDown(document, { key: "Escape" });
        await Promise.resolve();
        expect(cancelActivation).toHaveBeenCalledWith({
            gameId: "g",
            playerId: "p1",
        });
        expect(cancelCast).not.toHaveBeenCalled();
    });
});
