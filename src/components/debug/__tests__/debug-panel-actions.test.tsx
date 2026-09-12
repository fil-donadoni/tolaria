// The debug sheet's body carries THREE actions and nothing else (issue #3403,
// PRD #3397): the scenario list, reset game, copy state.
//
// The surface ships to testers in PRODUCTION now, so the seven buttons that
// bypassed the rules engine's own gates, restarted games out of the lobby, or
// wiped the presser's session had to go with it — and "gone" has to mean gone
// from the RENDER, not merely hidden behind a flag. These tests render the real
// panel and assert the button set, which is the whole acceptance criterion.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

const GAME = "game1" as Id<"games">;

/** What `getFullState` answers with — the payload "Copy State" must put on the
 *  clipboard verbatim, and the payload the retired state tree used to render. */
const FULL_STATE = { turn: 4, phase: "PRECOMBAT_MAIN" };

const mutationCalls: { ref: unknown; args: unknown }[] = [];

vi.mock("convex/react", () => ({
    useQuery: (ref: unknown, args: unknown) => {
        if (args === "skip") return undefined;
        const name = (ref as { name?: string } | undefined)?.name;
        if (name === "game.getFullState") return FULL_STATE;
        if (name === "users.currentUser") return { _id: "u1", isAdmin: true };
        return undefined;
    },
    useMutation: (ref: unknown) => (args: unknown) => {
        mutationCalls.push({ ref, args });
        return Promise.resolve(null);
    },
    useAction: () => () => Promise.resolve(null),
}));

// A Proxy stands in for the whole generated `api` so every ref the scenario
// subcomponents reach for resolves to a NAMED marker — the mock above reads
// that name, and a missing branch would otherwise crash on `undefined.name`
// rather than simply returning no data.
vi.mock("@convex/_generated/api", () => {
    const namespace = (prefix: string) =>
        new Proxy(
            {},
            { get: (_t, key) => ({ name: `${prefix}.${String(key)}` }) }
        );
    return {
        api: new Proxy({}, { get: (_t, key) => namespace(String(key)) }),
    };
});

const copyMinified = vi.fn<(value: unknown) => Promise<void>>(() =>
    Promise.resolve()
);
vi.mock("~/lib/clipboard", () => ({
    copyMinified: (value: unknown) => copyMinified(value),
    copyText: () => Promise.resolve(),
}));

const DebugPanel = (await import("../debug-panel")).default;

/** Every label issue #3403 removed, in both of the two-state spellings the
 *  buttons cycled through. */
const REMOVED_LABELS = [
    "Show all cards",
    "Hide cards",
    "All actions",
    "Rules on",
    "New Solo Game",
    "Restart Solo",
    "New vs-AI Game",
    "Restart vs AI",
    "Bo3 Sideboarding",
    "Verbose",
    "Verbose ON",
    "Clear Storage",
];

beforeEach(() => {
    mutationCalls.length = 0;
    copyMinified.mockClear();
});
afterEach(() => cleanup());

describe("Debug sheet body — the three actions (issue #3403)", () => {
    it("renders exactly the three actions", () => {
        render(<DebugPanel gameId={GAME} playerId="me" />);
        const labels = Array.from(document.querySelectorAll("button")).map(
            (b) => b.textContent
        );
        expect(labels).toEqual(["Scenarios", "Reset Game", "Copy State"]);
    });

    it("renders none of the seven removed buttons", () => {
        render(<DebugPanel gameId={GAME} playerId="me" />);
        for (const label of REMOVED_LABELS) {
            expect(screen.queryByText(label)).toBeNull();
        }
    });

    it("Reset Game still calls its existing mutation", () => {
        render(<DebugPanel gameId={GAME} playerId="me" />);
        fireEvent.click(screen.getByText("Reset Game"));
        const reset = mutationCalls.find(
            (c) => (c.ref as { name?: string }).name === "game.debugResetGame"
        );
        expect(reset).toBeDefined();
        expect(reset!.args).toEqual({ gameId: GAME });
    });

    it("Copy State still copies the minified payload the state tree used to show", () => {
        render(<DebugPanel gameId={GAME} playerId="me" />);
        fireEvent.click(screen.getByText("Copy State"));
        expect(copyMinified).toHaveBeenCalledWith(FULL_STATE);
        expect(screen.getByText("Copied!")).toBeTruthy();
    });

    it("opens the scenario list — the DB and blade lists, unchanged", () => {
        render(<DebugPanel gameId={GAME} playerId="me" />);
        fireEvent.click(screen.getByText("Scenarios"));
        // The two lists announce themselves through their own load controls;
        // asserting the section EXPANDS at all is what pins the action.
        expect(document.querySelectorAll("button").length).toBeGreaterThan(3);
    });

    it("pins the save form's head inside the sheet's scroll port", () => {
        // The sheet body is the port (`[data-debug-sheet-body]`), and the pin
        // is OPT-IN on the form (issue #3494) — `/admin/scenarios` mounts the
        // same form with no port of its own. So the wiring is a claim about
        // THIS caller, and without an assertion here dropping the prop would
        // red nothing offline.
        render(<DebugPanel gameId={GAME} playerId="me" />);
        fireEvent.click(screen.getByText("Scenarios"));
        expect(
            screen.getByText("Save to DB").closest("div.sticky")
        ).toBeTruthy();
    });

    it("no longer renders the raw state tree", () => {
        // Behavioural assertions cannot see a COLLAPSED `react-json-tree`, so
        // the guard is on the import itself: the tree can only come back
        // through this module, and it was the panel's whole height budget.
        const source = readFileSync(
            path.join(process.cwd(), "src/components/debug/debug-panel.tsx"),
            "utf8"
        );
        expect(source).not.toContain("json-tree-view");
        expect(source).not.toContain("JsonTreeView");
    });
});
