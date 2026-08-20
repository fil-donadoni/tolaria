// OrientationHint (issue #2594) — a dismissible, non-blocking nudge shown at
// most once per surface per browser session. Real `sessionStorage`, not a
// mock: the whole point of the "once per session" contract is the flag
// SURVIVING a remount, which only a real store (cleared here in
// `beforeEach`/`afterEach`, not replaced) actually proves.
//
// Assertions use plain `getByText`/`queryByText` (not jest-dom's
// `toBeInTheDocument`) — `tsconfig.app.json`'s restricted `types` array
// doesn't pick up jest-dom's type augmentation (see
// `draft-lab-term-breakdown.test.tsx`), and `getByText` itself throws when
// nothing matches, so a bare call already proves presence; `queryByText`
// returns `null` when absent, which `toBeNull()` (a native vitest matcher)
// covers directly.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import OrientationHint from "../orientation-hint";

beforeEach(() => {
    sessionStorage.clear();
});
afterEach(cleanup);

describe("OrientationHint — once per surface per session (issue #2594)", () => {
    it("renders on first mount for a surface never seen this session", () => {
        render(<OrientationHint surfaceId="game-board" message="Rotate me" />);
        screen.getByText("Rotate me");
        expect(
            screen.getByRole("status").getAttribute("data-orientation-hint")
        ).toBe("game-board");
    });

    it("does NOT render again after a remount in the same session", () => {
        const { unmount } = render(
            <OrientationHint surfaceId="game-board" message="Rotate me" />
        );
        screen.getByText("Rotate me");
        unmount();

        render(<OrientationHint surfaceId="game-board" message="Rotate me" />);
        expect(screen.queryByText("Rotate me")).toBeNull();
    });

    it("is dismissible — clicking the close button hides it immediately", () => {
        render(<OrientationHint surfaceId="game-board" message="Rotate me" />);
        screen.getByText("Rotate me");
        fireEvent.click(
            screen.getByRole("button", { name: "Dismiss orientation hint" })
        );
        expect(screen.queryByText("Rotate me")).toBeNull();
    });

    it("scopes the seen-flag per surfaceId — dismissing one surface does not suppress another", () => {
        const { unmount } = render(
            <OrientationHint surfaceId="game-board" message="Board hint" />
        );
        unmount();

        // A DIFFERENT surface, same session — must still show.
        render(<OrientationHint surfaceId="draft-room" message="Draft hint" />);
        screen.getByText("Draft hint");
    });
});
