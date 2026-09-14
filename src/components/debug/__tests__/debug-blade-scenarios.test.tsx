// The Debug panel's blade-scenario list (issue #3443).
//
// What this pins is the row's INFORMATION, not the loader: the entry's search
// budget as a column of its own, the rest of what the entry asks for in the
// row's `title`, and the vs-AI conversion notice — a permanent change to the
// developer's game that is invisible on the board itself, so it is announced
// here or not at all.
//
// The budget is the one fact that earns a column because it is the one a
// developer COMPARES against something else: the browser's difficulty preset
// searches at its own iteration count, and a Bot that does not make the play
// because it was never given the entry's budget looks exactly like a Bot that
// failed the entry.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import type { Id } from "@convex/_generated/dataModel";

const useQueryMock = vi.fn();
const loadMock = vi.fn();

vi.mock("convex/react", () => ({
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    useMutation: () => loadMock,
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Dev", isAdmin: true }),
}));

const DebugBladeScenarios = (await import("../debug-blade-scenarios")).default;

const GAME = "game1" as Id<"games">;

const ENTRY = {
    label: "stifles its own trigger",
    tier: "must" as const,
    note: "Guards issue #1427.",
    budget: 4000,
    expectation: "one of: cast-spell card=Stifle",
    beyondBudget: undefined as string | undefined,
};

function renderPanel(rows: (typeof ENTRY)[] = [ENTRY]) {
    useQueryMock.mockReturnValue(rows);
    return render(<DebugBladeScenarios gameId={GAME} />);
}

beforeEach(() => {
    cleanup();
    useQueryMock.mockReset();
    loadMock.mockReset();
    loadMock.mockResolvedValue({
        convertedToVsAi: false,
        botPlayerId: "user-1-p2",
    });
});

describe("DebugBladeScenarios — the entry's budget is on the row (issue #3443)", () => {
    it("renders the iteration count as its own column", () => {
        renderPanel();
        expect(screen.getByText("4000")).toBeTruthy();
    });

    it("puts the expectation, the note and the beyond-budget verdict in `title`, not the layout", () => {
        renderPanel([
            {
                ...ENTRY,
                beyondBudget: "horizon: the payoff sits behind a loop",
            },
        ]);
        const title = screen
            .getByRole("button", { name: /stifles its own trigger/ })
            .getAttribute("title");
        expect(title).toContain("one of: cast-spell card=Stifle");
        expect(title).toContain("4000 iterations");
        expect(title).toContain("horizon: the payoff sits behind a loop");
        expect(title).toContain("Guards issue #1427.");
        // …and none of it is rendered text: the list is 149 rows inside a
        // phone-width sheet.
        expect(screen.queryByText(/one of: cast-spell/)).toBeNull();
    });

    it("omits the beyond-budget line for an entry that carries no verdict", () => {
        renderPanel();
        const title = screen
            .getByRole("button", { name: /stifles its own trigger/ })
            .getAttribute("title");
        expect(title).not.toContain("Beyond budget");
    });
});

describe("DebugBladeScenarios — the vs-AI conversion is announced (issue #3443)", () => {
    it("says so when the load turned this solo game into a vs-AI game", async () => {
        renderPanel();
        loadMock.mockResolvedValue({
            convertedToVsAi: true,
            botPlayerId: "user-1-p2",
        });

        fireEvent.click(
            screen.getByRole("button", { name: /stifles its own trigger/ })
        );

        await waitFor(() =>
            expect(screen.getByText(/now a vs-AI game/)).toBeTruthy()
        );
    });

    it("says nothing when the game was already a vs-AI game", async () => {
        renderPanel();

        fireEvent.click(
            screen.getByRole("button", { name: /stifles its own trigger/ })
        );

        await waitFor(() => expect(loadMock).toHaveBeenCalled());
        expect(screen.queryByText(/now a vs-AI game/)).toBeNull();
    });

    it("shows the loader's refusal instead of a notice when it throws", async () => {
        renderPanel();
        loadMock.mockRejectedValue(
            new Error('declares bot "me", but the built position owes input')
        );

        fireEvent.click(
            screen.getByRole("button", { name: /stifles its own trigger/ })
        );

        await waitFor(() =>
            expect(screen.getByText(/owes input/)).toBeTruthy()
        );
        expect(screen.queryByText(/now a vs-AI game/)).toBeNull();
    });
});
