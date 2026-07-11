import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import BugReportDialog from "../bug-report-dialog";

// The dialog files a GitHub issue through the `bugReports` Convex functions.
// convex/react is mocked so the component's wiring (prefill, validation,
// pending-disable, success state) is exercised without a live backend.

let currentUser: { nickname: string; email?: string } | null;
const submitBugReport = vi.fn();
const generateUploadUrl = vi.fn();

vi.mock("convex/react", () => ({
    useQuery: () => currentUser,
    useMutation: () => generateUploadUrl,
    useAction: () => submitBugReport,
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
});
