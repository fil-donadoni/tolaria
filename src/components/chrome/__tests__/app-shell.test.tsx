// The shell's one decision: which routes wear the shared header. Tested on the
// pure predicate rather than by rendering the shell, which would need a live
// router — the predicate is the whole rule, and keeping it exported is what
// makes it testable at all.
import { describe, it, expect } from "vitest";
import { shellShowsHeader } from "../app-shell";

describe("shellShowsHeader", () => {
    it("shows the header on every ordinary section", () => {
        for (const pathname of [
            "/",
            "/limited",
            "/limited/abc123",
            "/limited/abc123/build",
            "/decks/create",
            "/decks/goblins/edit",
            "/admin",
            "/admin/draft-lab",
            "/join/xyz",
        ]) {
            expect(shellShowsHeader(pathname), pathname).toBe(true);
        }
    });

    it("hides it on the fullscreen board", () => {
        expect(shellShowsHeader("/game")).toBe(false);
    });

    it("hides it on paths nested under the board", () => {
        // Guards the prefix rule itself: `/game/anything` is still the board.
        expect(shellShowsHeader("/game/replay")).toBe(false);
    });

    it("does not treat a merely similar prefix as the board", () => {
        // `/games` is not `/game` — a naive `startsWith("/game")` would
        // silently strip the header from a future route with that name.
        expect(shellShowsHeader("/games")).toBe(true);
    });
});
