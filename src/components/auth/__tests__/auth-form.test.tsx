// `<AuthForm>` owns THREE modes, not two: sign-in, sign-up, and the handoff to
// `<ForgotPasswordForm>`. The handoff is the part with no server-side test
// behind it — a reset flow that is perfect in Convex is unreachable if no
// control on the sign-in screen switches to it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthForm } from "../auth-form";

const signIn = vi.fn();

vi.mock("@convex-dev/auth/react", () => ({
    useAuthActions: () => ({ signIn, signOut: vi.fn() }),
}));

vi.mock("~/components/lobby/lobby-background", () => ({
    default: () => <div data-testid="lobby-background" />,
}));

beforeEach(() => {
    signIn.mockReset();
    signIn.mockResolvedValue(undefined);
    document.title = "";
});

describe("the reset handoff", () => {
    it("offers `Forgot password?` on sign-in", () => {
        render(<AuthForm />);
        expect(
            screen.getByRole("button", { name: /forgot password/i })
        ).toBeTruthy();
    });

    it("hides it on sign-up, where there is nothing to reset yet", () => {
        render(<AuthForm />);
        fireEvent.click(
            screen.getByRole("button", { name: /no account\? sign up/i })
        );
        expect(
            screen.queryByRole("button", { name: /forgot password/i })
        ).toBeNull();
    });

    it("swaps in the reset screen, replacing the credentials form", () => {
        render(<AuthForm />);
        fireEvent.click(
            screen.getByRole("button", { name: /forgot password/i })
        );

        expect(screen.getByRole("button", { name: /send code/i })).toBeTruthy();
        // The sign-in submit is GONE, not merely hidden behind it.
        expect(screen.queryByRole("button", { name: /^sign in$/i })).toBeNull();
    });

    it("comes back to sign-in from the reset screen", () => {
        render(<AuthForm />);
        fireEvent.click(
            screen.getByRole("button", { name: /forgot password/i })
        );
        fireEvent.click(
            screen.getByRole("button", { name: /back to sign in/i })
        );

        expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
    });

    it("names the tab for the reset mode too", async () => {
        // React runs a parent's effects AFTER its children's, so the title has
        // to be set HERE. A `useDocumentTitle` inside `<ForgotPasswordForm>`
        // would be overwritten by this component's on every render.
        render(<AuthForm />);
        fireEvent.click(
            screen.getByRole("button", { name: /forgot password/i })
        );
        await waitFor(() => expect(document.title).toMatch(/Reset Password/));
    });
});

describe("the credentials flows still work", () => {
    it("signs in with the normalised address", async () => {
        render(<AuthForm />);
        fireEvent.change(screen.getByLabelText(/^email$/i), {
            target: { value: "  Pilot@Example.COM " },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
            target: { value: "correct horse battery" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

        await waitFor(() =>
            expect(signIn).toHaveBeenCalledWith("password", {
                email: "pilot@example.com",
                password: "correct horse battery",
                flow: "signIn",
            })
        );
    });

    it("still reports a bad sign-in without saying which half was wrong", async () => {
        signIn.mockRejectedValueOnce(
            new Error(
                "[Request ID: abc] Server Error\nUncaught Error: InvalidSecret"
            )
        );
        render(<AuthForm />);
        fireEvent.change(screen.getByLabelText(/^email$/i), {
            target: { value: "pilot@example.com" },
        });
        fireEvent.change(screen.getByLabelText(/^password$/i), {
            target: { value: "wrong password" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

        await waitFor(() =>
            expect(screen.getByRole("alert").textContent).toBe(
                "Invalid email or password"
            )
        );
    });
});
