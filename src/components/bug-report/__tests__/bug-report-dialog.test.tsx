import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { BUG_REPORT_CONSENT_VERSION } from "@convex/bugReportConsent";
import BugReportDialog from "../bug-report-dialog";

// The dialog files a GitHub issue through the `bugReports` Convex functions.
// convex/react is mocked so the component's wiring (prefill, validation,
// pending-disable, success state) is exercised without a live backend.

let currentUser: {
    nickname: string;
    email?: string;
    bugReportConsentVersion?: number;
} | null;
/** What `getStoredSession` reports — the game the reporter is sitting in. */
let sessionGameId: string | null;
/** What `collectAiDiagnostics` reports for the next submit. */
let aiDiagnostics: unknown;
const submitBugReport = vi.fn();
const generateUploadUrl = vi.fn();

vi.mock("convex/react", () => ({
    useQuery: () => currentUser,
    useMutation: () => generateUploadUrl,
    useAction: () => submitBugReport,
}));
// issue #2470 — the AI rings themselves are a bot-subsystem concern (and
// importing them here would put this jsdom test in the bot suite, which the
// boundary guard rejects). The dialog's own contract is narrower: attach
// whatever the collector returns, and nothing when it returns nothing.
vi.mock("~/lib/ai/diagnostics", () => ({
    collectAiDiagnostics: () => aiDiagnostics,
}));
vi.mock("~/lib/session", () => ({
    getStoredSession: () => ({ gameId: sessionGameId, playerId: null }),
}));
// The disclosure gate previews the payload through the shared JSON viewer
// (issue #3255). Stubbed to a flat dump so a test can read the previewed value
// back and compare it with what was submitted — `react-json-tree` renders its
// nodes COLLAPSED, which is right for a dialog and useless for an assertion.
vi.mock("@/components/ui/json-tree-view", () => ({
    default: ({ data }: { data: unknown }) => (
        <pre data-testid="payload-preview">{JSON.stringify(data)}</pre>
    ),
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        users: { currentUser: { _name: "currentUser" } },
        bugReports: {
            generateUploadUrl: { _name: "generateUploadUrl" },
            submitBugReport: { _name: "submitBugReport" },
        },
    },
}));

describe("BugReportDialog", () => {
    beforeEach(() => {
        // The common case: a returning reporter who already consented to the
        // CURRENT disclosure, so the acknowledgement is pre-accepted.
        currentUser = {
            nickname: "Ada",
            email: "ada@example.com",
            bugReportConsentVersion: BUG_REPORT_CONSENT_VERSION,
        };
        sessionGameId = null;
        localStorage.clear();
        submitBugReport.mockReset();
        generateUploadUrl.mockReset();
        submitBugReport.mockResolvedValue({
            issueUrl: "https://github.com/fil-donadoni/tolaria/issues/42",
        });
        aiDiagnostics = undefined;
    });

    it("prefills name and email from the signed-in account", () => {
        const { getByPlaceholderText } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        expect(
            (getByPlaceholderText("Your name") as HTMLInputElement).value
        ).toBe("Ada");
        expect(
            (getByPlaceholderText("you@example.com") as HTMLInputElement).value
        ).toBe("ada@example.com");
    });

    it("disables Submit until a description is entered", () => {
        const { getByRole, getByPlaceholderText } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        const submit = getByRole("button", {
            name: "Submit",
        }) as HTMLButtonElement;
        expect(submit.disabled).toBe(true);

        fireEvent.change(
            getByPlaceholderText("What happened? What did you expect?"),
            { target: { value: "It broke" } }
        );
        expect(submit.disabled).toBe(false);
    });

    it("submits the report and shows the created issue link", async () => {
        const { getByRole, getByPlaceholderText, findByText } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        fireEvent.change(
            getByPlaceholderText("What happened? What did you expect?"),
            { target: { value: "Board freezes on attack" } }
        );
        fireEvent.click(getByRole("button", { name: "Submit" }));

        await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1));
        expect(submitBugReport).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "Ada",
                email: "ada@example.com",
                description: "Board freezes on attack",
            })
        );
        const link = (await findByText(
            "View issue on GitHub"
        )) as HTMLAnchorElement;
        expect(link.href).toBe(
            "https://github.com/fil-donadoni/tolaria/issues/42"
        );
        // No attachment → the upload URL is never requested.
        expect(generateUploadUrl).not.toHaveBeenCalled();
    });

    it("surfaces a submit error without leaving the form", async () => {
        submitBugReport.mockRejectedValue(new Error("GitHub API error (403)"));
        const { getByRole, getByPlaceholderText, findByText } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        fireEvent.change(
            getByPlaceholderText("What happened? What did you expect?"),
            { target: { value: "boom" } }
        );
        fireEvent.click(getByRole("button", { name: "Submit" }));

        expect(await findByText("GitHub API error (403)")).toBeTruthy();
    });

    // In production Convex replaces a plain server-thrown Error's message with
    // "Server Error"; only a ConvexError payload reaches the client, so the
    // dialog must render `err.data` rather than `err.message`.
    it("surfaces the payload of a ConvexError thrown server-side", async () => {
        submitBugReport.mockRejectedValue(
            new ConvexError(
                "Bug reporting is not configured (missing GITHUB_TOKEN)"
            )
        );
        const { getByRole, getByPlaceholderText, findByText } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        fireEvent.change(
            getByPlaceholderText("What happened? What did you expect?"),
            { target: { value: "boom" } }
        );
        fireEvent.click(getByRole("button", { name: "Submit" }));

        expect(
            await findByText(
                "Bug reporting is not configured (missing GITHUB_TOKEN)"
            )
        ).toBeTruthy();
    });
    // issue #2470 — the play bot runs in THIS tab (ADR 0074), so a report is
    // the only way its decision history ever reaches a maintainer. #2450
    // arrived with a full board snapshot and nothing about the decision that
    // produced it, and could not be root-caused for exactly that reason.
    it("attaches the bot's decision ring when the bot has decided", async () => {
        aiDiagnostics = {
            decisions: [
                {
                    outcome: "worker-error",
                    expectedKind: "priority",
                    phase: "PRECOMBAT_MAIN",
                    seq: 9,
                    message: "Script error",
                    at: 0,
                },
            ],
            escalations: [],
        };

        const { getByRole, getByPlaceholderText } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        fireEvent.change(
            getByPlaceholderText("What happened? What did you expect?"),
            { target: { value: "BOT doesn't play any land" } }
        );
        fireEvent.click(getByRole("button", { name: "Submit" }));

        await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1));
        const args = submitBugReport.mock.calls[0][0] as {
            clientDiagnostics?: { decisions: { outcome: string }[] };
        };
        expect(args.clientDiagnostics?.decisions).toHaveLength(1);
        expect(args.clientDiagnostics?.decisions[0].outcome).toBe(
            "worker-error"
        );
    });

    it("omits the diagnostics entirely when there is no bot history", async () => {
        const { getByRole, getByPlaceholderText } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        fireEvent.change(
            getByPlaceholderText("What happened? What did you expect?"),
            { target: { value: "Typo in the lobby" } }
        );
        fireEvent.click(getByRole("button", { name: "Submit" }));

        await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1));
        const args = submitBugReport.mock.calls[0][0] as {
            clientDiagnostics?: unknown;
        };
        expect(args.clientDiagnostics).toBeUndefined();
    });

    // --- Disclosure gate (issue #3255) -----------------------------------
    //
    // A bug report ships the reporter's board, their AI decision ring and their
    // browser identity off their machine, and Sentry already receives their
    // console continuously. None of that was ever disclosed. These tests hold
    // the gate honest: what it says, what it defaults to, and that the preview
    // cannot drift from the payload.

    const CONSENT_LABEL = "Send this diagnostic payload with my report";

    function fillAndSubmit(
        ui: ReturnType<typeof render>,
        description = "Board freezes on attack"
    ) {
        fireEvent.change(
            ui.getByPlaceholderText("What happened? What did you expect?"),
            { target: { value: description } }
        );
        fireEvent.click(ui.getByRole("button", { name: "Submit" }));
    }

    it("names Sentry and the two-player board disclosure", () => {
        const { getByText } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        expect(
            getByText(/Sentry, a third-party monitoring service/)
        ).toBeTruthy();
        expect(
            getByText(
                /full\s+authoritative board, including the cards your opponent is\s+holding/
            )
        ).toBeTruthy();
    });

    it("leaves the gate unchecked for an account that has never consented, and sends no diagnostics", async () => {
        currentUser = { nickname: "Ada", email: "ada@example.com" };
        sessionGameId = "game_1";
        aiDiagnostics = { decisions: [], escalations: [] };
        const ui = render(<BugReportDialog open onOpenChange={() => {}} />);
        expect(
            (
                ui.getByRole("checkbox", {
                    name: CONSENT_LABEL,
                }) as HTMLInputElement
            ).getAttribute("aria-checked")
        ).toBe("false");

        fillAndSubmit(ui);
        await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1));
        const args = submitBugReport.mock.calls[0][0] as Record<
            string,
            unknown
        >;
        expect(args.diagnosticsConsent).toBe(false);
        expect(args.description).toBe("Board freezes on attack");
        expect(args.name).toBe("Ada");
        expect(args.route).toBeUndefined();
        expect(args.userAgent).toBeUndefined();
        expect(args.gameId).toBeUndefined();
        expect(args.clientDiagnostics).toBeUndefined();
    });

    // A consent is a consent to a SPECIFIC payload: when the payload widens the
    // constant rises, and an account that agreed to the narrower one is asked
    // again rather than silently licensing the wider one.
    it("re-asks when the stored consent is behind the current version", () => {
        currentUser = {
            nickname: "Ada",
            bugReportConsentVersion: BUG_REPORT_CONSENT_VERSION - 1,
        };
        const { getByRole } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        expect(
            getByRole("checkbox", { name: CONSENT_LABEL }).getAttribute(
                "aria-checked"
            )
        ).toBe("false");
    });

    // The decision lives on the USER RECORD, never in browser storage: browser
    // storage is per-browser and is cleared by the very class of problem a
    // reporter is most likely to be reporting.
    it("pre-accepts from the user record with browser storage empty", () => {
        localStorage.clear();
        expect(localStorage.length).toBe(0);
        const { getByRole } = render(
            <BugReportDialog open onOpenChange={() => {}} />
        );
        expect(
            getByRole("checkbox", { name: CONSENT_LABEL }).getAttribute(
                "aria-checked"
            )
        ).toBe("true");
    });

    it("still files the narrative report when the reporter declines", async () => {
        sessionGameId = "game_1";
        const ui = render(<BugReportDialog open onOpenChange={() => {}} />);
        fireEvent.click(ui.getByRole("checkbox", { name: CONSENT_LABEL }));
        fillAndSubmit(ui, "Something is off");

        await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1));
        const args = submitBugReport.mock.calls[0][0] as Record<
            string,
            unknown
        >;
        expect(args.diagnosticsConsent).toBe(false);
        expect(args.description).toBe("Something is off");
        expect(args.email).toBe("ada@example.com");
        expect(args.gameId).toBeUndefined();
        expect(args.route).toBeUndefined();
    });

    // The preview is not a hand-written list of what we collect — it renders
    // the very object the submission spreads, so the two cannot disagree.
    // The summary sits directly above "Decline and the report is still filed";
    // one that keeps promising the board after the box is cleared contradicts
    // the refusal it is explaining.
    it("stops promising the payload once the reporter declines", () => {
        sessionGameId = "game_7";
        const ui = render(<BugReportDialog open onOpenChange={() => {}} />);
        expect(
            ui.getByText(/the full board of the game you are in/)
        ).toBeTruthy();

        fireEvent.click(ui.getByRole("checkbox", { name: CONSENT_LABEL }));
        expect(
            ui.queryByText(/the full board of the game you are in/)
        ).toBeNull();
        expect(
            ui.getByText(/Sending: your description, your name and your email/)
        ).toBeTruthy();
    });

    it("previews the exact payload that is submitted", async () => {
        sessionGameId = "game_7";
        aiDiagnostics = { decisions: [{ outcome: "move" }], escalations: [] };
        const ui = render(<BugReportDialog open onOpenChange={() => {}} />);
        const previewed = JSON.parse(
            ui.getByTestId("payload-preview").textContent ?? "{}"
        ) as Record<string, unknown>;

        fillAndSubmit(ui);
        await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1));
        const args = submitBugReport.mock.calls[0][0] as Record<
            string,
            unknown
        >;
        for (const key of Object.keys(previewed)) {
            expect(args[key]).toEqual(previewed[key]);
        }
        expect(previewed.gameId).toBe("game_7");
        expect(previewed.clientDiagnostics).toEqual(aiDiagnostics);
    });

    it("changes the preview when the payload changes", () => {
        sessionGameId = "game_7";
        aiDiagnostics = undefined;
        const first = render(<BugReportDialog open onOpenChange={() => {}} />);
        const before = first.getByTestId("payload-preview").textContent;
        first.unmount();

        sessionGameId = "game_9";
        aiDiagnostics = { decisions: [{ outcome: "move" }], escalations: [] };
        const second = render(<BugReportDialog open onOpenChange={() => {}} />);
        const after = second.getByTestId("payload-preview").textContent;

        expect(after).not.toBe(before);
        expect(after).toContain("game_9");
        expect(before).not.toContain("game_9");
    });
});
