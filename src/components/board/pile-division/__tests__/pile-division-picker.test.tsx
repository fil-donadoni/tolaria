// Pile-division dialog (ADR 0053, Fact or Fiction). Covers the two render
// contracts that don't need a real drag gesture (jsdom has no layout, so
// pointer hit-testing against zone rects can't be exercised here — the drag
// path is covered by the projection + resolve tests plus manual QA):
//   • DIVIDE mode — Done is disabled while cards remain in the candidates row,
//     and every candidate renders a face.
//   • PICK mode — the two piles render with their counts and the Take buttons
//     submit "A" / "B" through `submitResolutionChoice`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance, PendingChoice } from "~/types/game";

const calls: { ref: unknown; args: unknown }[] = [];

vi.mock("@convex/_generated/api", () => ({
    api: { game: { submitResolutionChoice: "submitResolutionChoice" } },
}));

vi.mock("convex/react", () => ({
    useMutation: (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));

// The minimize affordance needs the minimized-choice context; irrelevant here.
vi.mock("~/components/board/minimize-choice-button", () => ({
    default: () => <button aria-label="Minimize" />,
    MINIMIZE_BUTTON_INSET: "top-2.5 right-2.5",
}));

// The single seam under test for the positioning describe block below — drive
// it explicitly so jsdom's flaky matchMedia never decides the branch (same
// pattern as usePromptBannerPosition.test.ts / prompt-banner-mobile-position.test.tsx).
let portrait = false;
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => portrait,
}));

const { default: PileDivisionPicker } = await import("../pile-division-picker");

function card(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
        isTapped: false,
    };
}

beforeEach(() => {
    calls.length = 0;
});

afterEach(() => {
    cleanup();
    portrait = false;
});

describe("PileDivisionPicker — divide mode", () => {
    const choice = {
        stackItemId: "s1",
        step: 0,
        choiceId: "fof:divide",
        playerId: "p2",
        kind: "divide-piles",
        zone: "library",
        count: { min: 0, max: 3 },
        candidateIds: ["l1", "l2", "l3"],
        prompt: "Separate into two piles.",
    } as unknown as PendingChoice;

    it("disables Done and shows the remaining count while cards are unplaced", () => {
        render(
            <PileDivisionPicker
                choice={choice}
                cards={[card("l1"), card("l2"), card("l3")]}
                playerId="p2"
                gameId={"g1" as never}
            />
        );
        const done = screen.getByRole("button", {
            name: "Done",
        }) as HTMLButtonElement;
        expect(done.disabled).toBe(true);
        expect(screen.getByText(/3 cards left/)).toBeTruthy();
        // Every candidate renders a face (img alt="" → role img has no name).
        expect(document.querySelectorAll("img").length).toBe(3);
    });
});

describe("PileDivisionPicker — pick mode", () => {
    const choice = {
        stackItemId: "s1",
        step: 0,
        choiceId: "fof:pick",
        playerId: "p1",
        kind: "pick-pile",
        count: 1,
        pileA: ["l1"],
        pileB: ["l2", "l3"],
        prompt: "Choose a pile.",
    } as unknown as PendingChoice;

    it("renders both pile counts and submits the chosen pile label", () => {
        render(
            <PileDivisionPicker
                choice={choice}
                cards={[card("l1"), card("l2"), card("l3")]}
                playerId="p1"
                gameId={"g1" as never}
            />
        );
        expect(screen.getByText("Pile A (1)")).toBeTruthy();
        expect(screen.getByText("Pile B (2)")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "Take Pile B" }));
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("submitResolutionChoice");
        expect(calls[0].args).toMatchObject({
            gameId: "g1",
            playerId: "p1",
            choiceId: "fof:pick",
            cardInstanceIds: ["B"],
        });
    });
});

// Issue #1762 review finding 4 — this dialog used to hardcode its own
// `absolute top-1/2 left-1/2` + `useDraggable` recipe (the same dead-center
// bug the small prompt banners had), AND the 560px-wide 3-zone stage
// (`STAGE_W`, layout.ts) had no cap, overflowing a 390px portrait viewport.
describe("PileDivisionPicker — mobile positioning (issue #1762)", () => {
    const choice = {
        stackItemId: "s1",
        step: 0,
        choiceId: "fof:divide",
        playerId: "p2",
        kind: "divide-piles",
        zone: "library",
        count: { min: 0, max: 3 },
        candidateIds: ["l1", "l2"],
        prompt: "Separate into two piles.",
    } as unknown as PendingChoice;

    it("routes positioning through the shared hook — never centers on the board in portrait", () => {
        portrait = true;
        const { container } = render(
            <PileDivisionPicker
                choice={choice}
                cards={[card("l1"), card("l2")]}
                playerId="p2"
                gameId={"g1" as never}
            />
        );
        const outer = container.firstElementChild as HTMLElement;
        expect(outer.className).not.toContain("top-1/2");
        expect(outer.className).not.toContain("left-1/2");
        expect(outer.className).toContain("fixed");
        expect(outer.className).toContain("env(safe-area-inset-top)");
    });

    it("keeps the desktop/landscape centered + draggable behavior unchanged", () => {
        portrait = false;
        const { container } = render(
            <PileDivisionPicker
                choice={choice}
                cards={[card("l1"), card("l2")]}
                playerId="p2"
                gameId={"g1" as never}
            />
        );
        const outer = container.firstElementChild as HTMLElement;
        expect(outer.className).toContain("top-1/2");
        expect(outer.className).toContain("left-1/2");
    });

    it("wraps the fixed-width 3-zone stage in a horizontal-scroll viewport (cap/scroll, not overflow)", () => {
        const { container } = render(
            <PileDivisionPicker
                choice={choice}
                cards={[card("l1"), card("l2")]}
                playerId="p2"
                gameId={"g1" as never}
            />
        );
        const scrollViewport = container.querySelector(
            ".overflow-x-auto"
        ) as HTMLElement | null;
        expect(scrollViewport).not.toBeNull();
        expect(scrollViewport!.className).toContain("max-w-full");
        // The stage itself keeps its fixed geometry (STAGE_W) — only its
        // VIEWPORT is capped — so the drop-zone hit-testing math is untouched.
        const stage = scrollViewport!.firstElementChild as HTMLElement;
        expect(stage.style.width).toBe("560px");
    });
});
