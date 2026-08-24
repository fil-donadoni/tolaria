// The password-reset screen, driven through the REAL component: what it sends
// to `signIn` is the whole contract with `convex/auth.ts`, and a typo in the
// `flow` string or a dropped `newPassword` is a feature that is dead on
// arrival with every server-side test still green.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForgotPasswordForm } from "../forgot-password-form";

const signIn = vi.fn();

vi.mock("@convex-dev/auth/react", () => ({
    useAuthActions: () => ({ signIn, signOut: vi.fn() }),
}));

/** How a Convex server error actually reaches the client. */
function serverError(identifier: string): Error {
    return new Error(
        `[Request ID: abc123] Server Error\nUncaught Error: ${identifier}`
    );
}

function fill(label: RegExp, value: string): void {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Walk step one so the assertions below start on the code screen. */
async function reachVerifyStep(email = "pilot@example.com"): Promise<void> {
    fill(/^email$/i, email);
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByLabelText(/verification code/i);
}

beforeEach(() => {
    signIn.mockReset();
    signIn.mockResolvedValue(undefined);
});

describe("step 1 — requesting a code", () => {
    it("asks the server for a reset with the normalised address", async () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep("  Pilot@Example.COM ");

        expect(signIn).toHaveBeenCalledWith("password", {
            email: "pilot@example.com",
            flow: "reset",
        });
    });

    it("advances even when the address has NO account", async () => {
        // The anti-enumeration rule: an unknown address must look exactly like
        // a known one from the outside.
        signIn.mockRejectedValueOnce(serverError("InvalidAccountId"));
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep("ghost@example.com");

        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByRole("status").textContent).toMatch(
            /if an account exists for ghost@example\.com/i
        );
    });

    it("stops on a REAL send failure instead of promising a code", async () => {
        signIn.mockRejectedValueOnce(
            new Error("Resend rejected the password-reset email (403)")
        );
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        fill(/^email$/i, "pilot@example.com");
        fireEvent.click(screen.getByRole("button", { name: /send code/i }));

        await waitFor(() =>
            expect(screen.getByRole("alert").textContent).toMatch(
                /could not send the code/i
            )
        );
        expect(screen.queryByLabelText(/verification code/i)).toBeNull();
    });

    it("does not call the server for an empty address", () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: /send code/i }));
        expect(signIn).not.toHaveBeenCalled();
    });
});

describe("step 2 — verifying the code and setting the password", () => {
    it("sends email, code and newPassword under the reset-verification flow", async () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep();
        signIn.mockClear();

        fill(/verification code/i, "12345678");
        fill(/^new password$/i, "correct horse battery");
        fill(/confirm new password/i, "correct horse battery");
        fireEvent.click(
            screen.getByRole("button", { name: /reset password/i })
        );

        await waitFor(() =>
            expect(signIn).toHaveBeenCalledWith("password", {
                email: "pilot@example.com",
                code: "12345678",
                newPassword: "correct horse battery",
                flow: "reset-verification",
            })
        );
    });

    it("strips the grouping a mail client shows, so a paste works", async () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep();
        signIn.mockClear();

        // The email renders the code as "1234 5678"; that is what gets pasted.
        fill(/verification code/i, "1234 5678");
        fill(/^new password$/i, "correct horse battery");
        fill(/confirm new password/i, "correct horse battery");
        fireEvent.click(
            screen.getByRole("button", { name: /reset password/i })
        );

        await waitFor(() => expect(signIn).toHaveBeenCalled());
        expect(signIn.mock.calls[0][1].code).toBe("12345678");
    });

    it("refuses a mismatched confirmation without touching the server", async () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep();
        signIn.mockClear();

        fill(/verification code/i, "12345678");
        fill(/^new password$/i, "correct horse battery");
        fill(/confirm new password/i, "correct hose battery");
        fireEvent.click(
            screen.getByRole("button", { name: /reset password/i })
        );

        expect(signIn).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toMatch(
            /passwords do not match/i
        );
    });

    it("refuses a short password without touching the server", async () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep();
        signIn.mockClear();

        fill(/verification code/i, "12345678");
        fill(/^new password$/i, "short");
        fill(/confirm new password/i, "short");
        fireEvent.click(
            screen.getByRole("button", { name: /reset password/i })
        );

        expect(signIn).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toMatch(
            /at least 8 characters/i
        );
    });

    it("refuses an incomplete code without touching the server", async () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep();
        signIn.mockClear();

        fill(/verification code/i, "1234");
        fill(/^new password$/i, "correct horse battery");
        fill(/confirm new password/i, "correct horse battery");
        fireEvent.click(
            screen.getByRole("button", { name: /reset password/i })
        );

        expect(signIn).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toMatch(/8-digit code/i);
    });

    it("reports a rejected code and leaves the user on the step", async () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep();
        signIn.mockClear();
        signIn.mockRejectedValueOnce(serverError("Could not verify code"));

        fill(/verification code/i, "00000000");
        fill(/^new password$/i, "correct horse battery");
        fill(/confirm new password/i, "correct horse battery");
        fireEvent.click(
            screen.getByRole("button", { name: /reset password/i })
        );

        await waitFor(() =>
            expect(screen.getByRole("alert").textContent).toMatch(
                /not valid or has expired/i
            )
        );
        // Still on step 2 — a failed code must not throw away the address.
        expect(screen.getByLabelText(/verification code/i)).toBeTruthy();
    });

    it("re-enables the submit button after a failure", async () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep();
        signIn.mockRejectedValueOnce(serverError("Could not verify code"));

        fill(/verification code/i, "00000000");
        fill(/^new password$/i, "correct horse battery");
        fill(/confirm new password/i, "correct horse battery");
        const submit = screen.getByRole("button", { name: /reset password/i });
        fireEvent.click(submit);

        await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
        expect(
            (
                screen.getByRole("button", {
                    name: /reset password/i,
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
    });
});

describe("getting back out", () => {
    it("`Use a different email` returns to step 1", async () => {
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep();

        fireEvent.click(
            screen.getByRole("button", { name: /use a different email/i })
        );

        expect(screen.getByLabelText(/^email$/i)).toBeTruthy();
        expect(screen.queryByLabelText(/verification code/i)).toBeNull();
    });

    it("does not carry the old code into the next attempt", async () => {
        // Going back and forward again must not re-present a code minted for
        // a DIFFERENT address — it would be spent on the wrong account and
        // burn one of the ten attempts an hour the limiter allows.
        render(<ForgotPasswordForm onCancel={vi.fn()} />);
        await reachVerifyStep("first@example.com");
        fill(/verification code/i, "12345678");
        expect(
            (screen.getByLabelText(/verification code/i) as HTMLInputElement)
                .value
        ).toBe("12345678");

        fireEvent.click(
            screen.getByRole("button", { name: /use a different email/i })
        );
        await reachVerifyStep("second@example.com");

        expect(
            (screen.getByLabelText(/verification code/i) as HTMLInputElement)
                .value
        ).toBe("");
    });

    it("`Back to sign in` hands control to the caller", () => {
        const onCancel = vi.fn();
        render(<ForgotPasswordForm onCancel={onCancel} />);
        fireEvent.click(
            screen.getByRole("button", { name: /back to sign in/i })
        );
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
