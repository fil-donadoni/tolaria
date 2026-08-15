// `/admin/bug-reports` — list newest-first, selecting a row shows the detail
// with email as `mailto:`, attachment, linked issue and the snapshot header +
// collapsible state JSON (issue #2250). The list/detail split is the thing
// worth pinning: the list query's rows carry no `state` field at all — a
// snapshot only ever appears after a row is selected and the detail query
// runs.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import BugReportsAdminPanel from "../bug-reports-admin-panel";

const copyText = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/clipboard", () => ({
    copyText: (...args: unknown[]) => copyText(...args),
}));
vi.mock("@/lib/clipboard", () => ({
    copyText: (...args: unknown[]) => copyText(...args),
}));

const LIST = [
    {
        _id: "report-1",
        filedAt: 1700000000000,
        name: "Ada",
        descriptionPreview: "Board freezes on attack",
        issueNumber: 42,
        hasSnapshot: true,
        hasAttachment: true,
        hasDiagnostics: true,
    },
    {
        _id: "report-2",
        filedAt: 1700000100000,
        name: "Grace",
        descriptionPreview: "Lobby is blank",
        issueNumber: undefined,
        hasSnapshot: false,
        hasAttachment: false,
        hasDiagnostics: false,
    },
];

const DETAIL: Record<string, unknown> = {
    "report-1": {
        name: "Ada",
        email: "ada@example.com",
        description: "Board freezes on attack\nmore detail",
        route: "/game",
        userAgent: "Mozilla/5.0",
        attachmentName: "board.png",
        attachmentUrl: "https://storage.example/board.png",
        clientDiagnostics: {
            decisions: [
                {
                    outcome: "worker-error",
                    expectedKind: "priority",
                    phase: "PRECOMBAT_MAIN",
                    seq: 7,
                    message: "Script error",
                    at: 1700000000000,
                },
            ],
            escalations: [],
        },
        gameId: "game-1",
        seq: 7,
        state: {
            turn: 3,
            phase: "COMBAT",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            pendingActivation: { abilityId: "x" },
        },
        issueNumber: 42,
        issueUrl: "https://github.com/fil-donadoni/tolaria/issues/42",
        filedAt: 1700000000000,
    },
};

vi.mock("convex/react", () => ({
    useQuery: (query: { _name: string }, args: unknown) => {
        if (query._name === "listBugReports") return LIST;
        if (query._name === "getBugReport") {
            const { reportId } = args as { reportId: string };
            return DETAIL[reportId] ?? null;
        }
        return undefined;
    },
}));

vi.mock("@convex/_generated/api", () => {
    const leaf = (name: string): unknown =>
        new Proxy(
            { _name: name },
            {
                get: (target, prop) =>
                    prop === "_name" || typeof prop === "symbol"
                        ? Reflect.get(target, prop)
                        : leaf(String(prop)),
            }
        );
    return { api: leaf("") };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("BugReportsAdminPanel", () => {
    it("lists every report newest — reporter, description preview, linked issue, snapshot flag", () => {
        render(<BugReportsAdminPanel />);
        expect(screen.getByText("Ada")).toBeTruthy();
        expect(screen.getByText("Board freezes on attack")).toBeTruthy();
        expect(screen.getByText("#42")).toBeTruthy();
        expect(screen.getByText("Grace")).toBeTruthy();
        expect(screen.getByText("Lobby is blank")).toBeTruthy();
    });

    // issue #2470 — the rings are the ONLY record of why a client-hosted bot's
    // decision failed (ADR 0074). An admin scanning the list must be able to
    // tell which reports carry them without opening each one, and the detail
    // must actually render them.
    it("flags the reports carrying AI diagnostics, and renders them on selection", () => {
        render(<BugReportsAdminPanel />);
        expect(screen.getAllByText("AI").length).toBe(1);

        fireEvent.click(screen.getByText("Ada"));
        expect(screen.getByText("AI diagnostics")).toBeTruthy();
    });

    it("shows no AI section for a report that carries no rings", () => {
        // A real detail row for Grace — without one the panel renders "Report
        // not found" and the assertion below would pass for the wrong reason
        // (it did, until the proof-of-failure sweep caught it).
        DETAIL["report-2"] = {
            name: "Grace",
            email: "grace@example.com",
            description: "Lobby is blank",
            attachmentUrl: null,
            filedAt: 1700000100000,
        };
        render(<BugReportsAdminPanel />);
        fireEvent.click(screen.getByText("Grace"));

        expect(screen.getByText("grace@example.com")).toBeTruthy();
        expect(screen.queryByText("AI diagnostics")).toBeNull();
    });

    it("shows nothing selected by default", () => {
        render(<BugReportsAdminPanel />);
        expect(
            screen.getByText("Select a report to see the full evidence.")
        ).toBeTruthy();
    });

    it("selecting a row shows the detail: email as mailto, description, route, user agent", () => {
        render(<BugReportsAdminPanel />);
        fireEvent.click(screen.getByText("Ada"));

        const mailLink = screen.getByText("ada@example.com");
        expect(mailLink.getAttribute("href")).toBe("mailto:ada@example.com");
        // The list row shows only the first line; the detail panel shows the
        // whole (multi-line) description — this text is unique to it.
        expect(screen.getByText(/more detail/)).toBeTruthy();
        expect(screen.getByText("Route: /game")).toBeTruthy();
        expect(screen.getByText("User agent: Mozilla/5.0")).toBeTruthy();
    });

    it("renders the linked issue as a link", () => {
        render(<BugReportsAdminPanel />);
        fireEvent.click(screen.getByText("Ada"));

        const link = screen.getByText("Issue #42");
        expect(link.getAttribute("href")).toBe(
            "https://github.com/fil-donadoni/tolaria/issues/42"
        );
    });

    it("renders an image attachment inline", () => {
        render(<BugReportsAdminPanel />);
        fireEvent.click(screen.getByText("Ada"));

        const img = screen.getByAltText("board.png") as HTMLImageElement;
        expect(img.src).toBe("https://storage.example/board.png");
    });

    it("shows the snapshot header — game id, seq, turn, phase, active/priority, owed input", () => {
        render(<BugReportsAdminPanel />);
        fireEvent.click(screen.getByText("Ada"));

        expect(screen.getByText("game-1")).toBeTruthy();
        expect(screen.getByText(/seq 7/)).toBeTruthy();
        expect(screen.getByText(/turn 3/)).toBeTruthy();
        expect(screen.getByText(/COMBAT/)).toBeTruthy();
        expect(screen.getByText(/active: p1/)).toBeTruthy();
        expect(screen.getByText(/priority: p2/)).toBeTruthy();
        expect(screen.getByText(/pendingActivation/)).toBeTruthy();
    });

    it("copies the raw state JSON to the clipboard", () => {
        render(<BugReportsAdminPanel />);
        fireEvent.click(screen.getByText("Ada"));
        fireEvent.click(screen.getByText("Copy state JSON"));

        const expectedState = (DETAIL["report-1"] as { state: unknown }).state;
        expect(copyText).toHaveBeenCalledTimes(1);
        expect(copyText.mock.calls[0][0]).toBe(
            JSON.stringify(expectedState, null, 2)
        );
    });

    it("a report with no snapshot shows no snapshot header or copy button", () => {
        DETAIL["report-2"] = {
            name: "Grace",
            email: "grace@example.com",
            description: "Lobby is blank",
            attachmentUrl: null,
            filedAt: 1700000100000,
        };
        render(<BugReportsAdminPanel />);
        fireEvent.click(screen.getByText("Grace"));

        expect(screen.queryByText("Copy state JSON")).toBeNull();
    });
});
