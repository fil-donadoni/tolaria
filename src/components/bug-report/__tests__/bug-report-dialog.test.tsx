import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import BugReportDialog from "../bug-report-dialog";

// The dialog files a GitHub issue through the `bugReports` Convex functions.
// convex/react is mocked so the component's wiring (prefill, validation,
// pending-disable, success state) is exercised without a live backend.

let currentUser: { nickname: string; email?: string } | null;
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
        currentUser = { nickname: "Ada", email: "ada@example.com" };
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
});
