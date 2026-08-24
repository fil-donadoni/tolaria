// `src/lib/auth-errors.ts` — the server-identifier → human-sentence mapping.
//
// The assertions that matter are the NEGATIVE ones: sign-in must not say which
// half was wrong, and the reset-request screen must not say whether an address
// has an account. Both are enumeration oracles open to any anonymous caller.
import { describe, it, expect } from "vitest";
import { friendlyAuthError, isUnknownAccountError } from "../auth-errors";

/** How a Convex server error actually reaches the client. */
function serverError(identifier: string): Error {
    return new Error(
        `[Request ID: abc123] Server Error\nUncaught Error: ${identifier}\n    at handler`
    );
}

describe("isUnknownAccountError", () => {
    it("is true only for the account-does-not-exist identifier", () => {
        expect(isUnknownAccountError(serverError("InvalidAccountId"))).toBe(
            true
        );
        expect(isUnknownAccountError(serverError("InvalidSecret"))).toBe(false);
        expect(
            isUnknownAccountError(serverError("TooManyFailedAttempts"))
        ).toBe(false);
        expect(isUnknownAccountError("not an error at all")).toBe(false);
    });
});

describe("friendlyAuthError — sign-in reveals nothing about the account", () => {
    it("gives the SAME sentence for a missing account and a wrong password", () => {
        const missing = friendlyAuthError(
            serverError("InvalidAccountId"),
            "signIn"
        );
        const wrongPassword = friendlyAuthError(
            serverError("InvalidSecret"),
            "signIn"
        );
        expect(missing).toBe(wrongPassword);
        expect(missing).toBe("Invalid email or password");
    });

    it("names the duplicate-address case on sign-up, where it is not a leak", () => {
        // Sign-up cannot hide it: creating the account is what fails.
        expect(
            friendlyAuthError(serverError("AccountAlreadyExists"), "signUp")
        ).toMatch(/already exists/i);
    });
});

describe("friendlyAuthError — reset", () => {
    it("collapses wrong / expired / wrong-address codes into one sentence", () => {
        const sentences = new Set(
            ["Invalid code", "InvalidAccountId", "InvalidSecret"].map((id) =>
                friendlyAuthError(serverError(id), "resetVerify")
            )
        );
        expect(sentences.size).toBe(1);
        expect([...sentences][0]).toMatch(/not valid or has expired/i);
    });

    it("lets the rate limiter win over the generic code failure", () => {
        // A throttled check and a wrong code arrive by the same path; the
        // throttle is the one the user can act on ("wait"), so it must not be
        // swallowed by the code branch above it.
        expect(
            friendlyAuthError(
                serverError("TooManyFailedAttempts"),
                "resetVerify"
            )
        ).toMatch(/too many failed attempts/i);
        expect(
            friendlyAuthError(serverError("TooManyFailedAttempts"), "signIn")
        ).toMatch(/too many failed attempts/i);
    });

    it("points at the length rule when the new password is too short", () => {
        expect(
            friendlyAuthError(serverError("Invalid password"), "resetVerify")
        ).toMatch(/at least 8 characters/i);
    });

    it("reports a send failure on the request step without naming the account", () => {
        const message = friendlyAuthError(
            new Error("Resend rejected the password-reset email (403)"),
            "resetRequest"
        );
        expect(message).toMatch(/could not send the code/i);
        // The point of the whole step: nothing in the sentence says whether
        // an account exists.
        expect(message).not.toMatch(/account|exist|unknown|found/i);
    });
});

describe("friendlyAuthError — unrecognised failures", () => {
    it("still returns an actionable sentence per step, never the raw error", () => {
        for (const step of [
            "signIn",
            "signUp",
            "resetRequest",
            "resetVerify",
        ] as const) {
            const message = friendlyAuthError(
                new Error("ECONNRESET reading from upstream"),
                step
            );
            expect(message).not.toMatch(/ECONNRESET/);
            expect(message.length).toBeGreaterThan(10);
        }
    });
});
