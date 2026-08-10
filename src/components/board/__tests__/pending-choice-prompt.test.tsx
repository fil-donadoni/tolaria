import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { PendingChoice } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import PendingChoicePrompt from "../pending-choice-prompt";

// The prompt fires Convex mutations through useMutation — stub with no-ops.
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
}));

// Drive the portrait/desktop seam explicitly so jsdom's flaky matchMedia
// never decides the branch (same pattern as usePromptBannerPosition.test.ts)
// — the "longest prompt at 390px" test below asserts the portrait wrap-cap.
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => true,
}));

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

function promptTree(choice: PendingChoice, playerId = "me") {
    const value = {
        gameId: "game-id" as never,
        playerId,
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [{ id: "me", name: "Me" }],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        pendingChoices: [choice],
    } as unknown as React.ContextType<typeof GameContext>;
    return (
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <MinimizedChoiceContext
                    value={{
                        isMinimized: false,
                        minimize: () => {},
                        restore: () => {},
                    }}
                >
                    <PendingChoicePrompt
                        choice={choice}
                        playerId={playerId}
                        gameId={"game-id" as never}
                    />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

function renderPrompt(choice: PendingChoice, playerId = "me") {
    return render(promptTree(choice, playerId));
}

describe("PendingChoicePrompt suppression", () => {
    // reorder-library owns the full-screen LibraryOrderPicker (mounted by
    // PlayerLibrary). The generic banner must NOT double up — its buffered
    // "N / max selected" Done would submit an empty (illegal) selection.
    it("renders nothing for a reorder-library choice (the drag picker owns it)", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "reorder-library",
            zone: "library",
            count: 3,
            prompt: "Put these cards back in any order (rightmost = top).",
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).toBeNull();
    });

    it("still renders the generic banner for a non-picker choice (control)", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "search-library",
            zone: "library",
            count: 1,
            prompt: "Search your library for a card.",
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).not.toBeNull();
    });
});

// Regression (issue #1698) — pins the router's existing chooser-vs-owner
// discrimination for `choose-hand-card` so a future change can't silently
// flip it back to an own-hand assumption: cross-player picks (Thoughtseize /
// Duress / Seer's Vision) yield to the dedicated `HandCardPick` modal;
// own-hand picks (discard-from-your-own-hand, put-back-on-top) keep the
// generic banner unchanged.
describe("PendingChoicePrompt — choose-hand-card (issue #1698)", () => {
    it("yields (renders nothing) for a cross-player pick — HandCardPick owns it", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "choose-hand-card",
            zone: "hand",
            zoneOwnerId: "opponent",
            count: 1,
            prompt: "Choose a card",
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).toBeNull();
    });

    it("still renders the generic banner for an own-hand pick (zoneOwnerId omitted)", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "choose-hand-card",
            zone: "hand",
            count: 1,
            prompt: "Choose a card to discard.",
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).not.toBeNull();
    });

    it("still renders the generic banner for an own-hand pick (zoneOwnerId === viewer)", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "choose-hand-card",
            zone: "hand",
            zoneOwnerId: "me",
            count: 1,
            prompt: "Put a card back on top.",
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).not.toBeNull();
    });
});

// Regression (#1719 review finding 1) — the #1698 router keyed the
// suppression on `kind === "choose-hand-card"` and missed the identical
// cross-player shape under `discard-hand` (Mind Warp, Leshrac's Sigil): the
// generic banner kept showing a "0 / max selected" counter over cards the
// viewer can't reach in-place, on top of nothing else offering a reachable
// Done — the exact hang this suite exists to catch. Gated on
// "chooser ≠ zone owner", not `kind`.
describe("PendingChoicePrompt — discard-hand (issue #1698 / #1719 review finding 1)", () => {
    it("yields (renders nothing) for a cross-player discard-hand pick — HandCardPick owns it", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "discard-hand",
            zone: "hand",
            zoneOwnerId: "opponent",
            count: 1,
            prompt: "Mind Warp: choose cards for that player to discard.",
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).toBeNull();
    });

    it("still renders the generic banner for an own-hand discard-hand pick (zoneOwnerId omitted, e.g. cleanup discard)", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "discard-hand",
            zone: "hand",
            count: 1,
            prompt: "Discard a card (hand size)",
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).not.toBeNull();
    });
});

describe("PendingChoicePrompt — pick-pile (ADR 0053, pile division)", () => {
    it("yields (renders nothing) for the chooser — the PileDivisionPicker owns the pick surface", () => {
        // ADR 0053: the chooser's face-up two-pile pick moved out of the generic
        // banner into the dedicated `PileDivisionPicker` (mounted by the board),
        // so `PendingChoicePrompt` suppresses itself here to avoid doubling up.
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "pick-pile",
            count: 1,
            prompt: "Choose a pile.",
            pileA: ["c1", "c2"],
            pileB: ["c3"],
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).toBeNull();
    });

    it("shows the waiting banner (not the option buttons) for the non-chooser viewer", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "opponent",
            playerId: "opponent",
            kind: "pick-pile",
            count: 1,
            prompt: "Choose a pile.",
            pileA: ["c1"],
            pileB: ["c2"],
        } as PendingChoice;
        const { queryByText, getByText } = renderPrompt(choice, "me");
        expect(queryByText(/Pile A/)).toBeNull();
        expect(getByText(/Waiting for/)).toBeTruthy();
    });
});

describe("PendingChoicePrompt — madness-cast (CR 702.35a)", () => {
    const madnessChoice = (playerId: string): PendingChoice =>
        ({
            stackItemId: "",
            step: 0,
            choiceId: "madness-cast-c1",
            playerId,
            kind: "madness-cast",
            cardInstanceId: "c1",
            subjectCardId: "basking-rootwalla",
            cost: {},
            count: 1,
            prompt: "Cast Basking Rootwalla for its madness cost, or put it into your graveyard?",
        }) as PendingChoice;

    it("renders Cast + Decline buttons for the owner (the trigger shows the choice — no exile click)", () => {
        const { getByText } = renderPrompt(madnessChoice("me"), "me");
        expect(getByText("Cast")).toBeTruthy();
        expect(getByText("Decline")).toBeTruthy();
    });

    it("shows only the waiting banner (no buttons) for the opponent", () => {
        const { queryByText, getByText } = renderPrompt(
            madnessChoice("opponent"),
            "me"
        );
        expect(queryByText("Cast")).toBeNull();
        expect(queryByText("Decline")).toBeNull();
        expect(getByText(/Waiting for/)).toBeTruthy();
    });
});

// Issue #1762 — `choice.prompt` is server-authored oracle-derived text with
// no length cap (the true worst case for wrapping, unlike the other banners'
// fixed literals). It must render in full at a 390px width without a
// nowrap/truncate class clipping it.
describe("PendingChoicePrompt — longest prompt renders without broken wrapping (issue #1762)", () => {
    it("a long option-pick prompt renders in full at a 390px width", () => {
        const longPrompt =
            "Choose one — Destroy target creature; or Return target creature card from your graveyard to your hand; or Search your library for a basic land card, reveal it, put it into your hand, then shuffle.";
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "option-pick",
            count: 1,
            prompt: longPrompt,
            options: [],
        } as PendingChoice;
        const { container } = render(
            <div style={{ width: "390px" }}>{promptTree(choice)}</div>
        );
        expect(container.textContent).toContain(longPrompt);
        // Issue #1762 review finding 7 — a bare `not.toMatch(/whitespace-nowrap/)`
        // can never fail (nothing here ever adds that class), so it isn't
        // proof of anything. Assert what this change actually owns instead:
        // the portrait wrap-cap this prompt picked up from the shared
        // `usePromptBannerPosition` hook (`max-w-[22rem]` on the inner
        // wrapper) — the real mechanism that keeps this unbounded
        // server-authored prompt from forcing the panel wider than the
        // 390px viewport.
        // container > the test's own 390px width div (a plain DOM node) >
        // PendingChoicePrompt's outer positioning div > the inner wrapper.
        const widthProbe = container.firstElementChild as HTMLElement;
        const outer = widthProbe.firstElementChild as HTMLElement;
        const inner = outer.firstElementChild as HTMLElement;
        expect(inner.className).toContain("max-w-[22rem]");
    });
});

describe("PendingChoicePrompt — rebound-cast (CR 702.88a)", () => {
    // Parallel to madness-cast above: same two-button Cast/Decline UI, no
    // cost symbols shown (Rebound's recast is always free — `cost` is
    // omitted, unlike Madness's `{}`).
    const reboundChoice = (playerId: string): PendingChoice =>
        ({
            stackItemId: "",
            step: 0,
            choiceId: "rebound-cast-c1",
            playerId,
            kind: "rebound-cast",
            cardInstanceId: "c1",
            subjectCardId: "ephemerate",
            count: 1,
            prompt: "Cast Ephemerate again from exile without paying its mana cost, or leave it exiled?",
        }) as PendingChoice;

    it("renders Cast + Decline buttons for the caster", () => {
        const { getByText } = renderPrompt(reboundChoice("me"), "me");
        expect(getByText("Cast")).toBeTruthy();
        expect(getByText("Decline")).toBeTruthy();
    });

    it("shows only the waiting banner (no buttons) for the opponent", () => {
        const { queryByText, getByText } = renderPrompt(
            reboundChoice("opponent"),
            "me"
        );
        expect(queryByText("Cast")).toBeNull();
        expect(queryByText("Decline")).toBeNull();
        expect(getByText(/Waiting for/)).toBeTruthy();
    });
});
