/**
 * Turning a `@convex-dev/auth` failure into something a person can act on.
 *
 * Every auth flow reaches the client as one opaque `Error` whose message is a
 * server-side identifier (`InvalidAccountId`, `InvalidSecret`,
 * `TooManyFailedAttempts`) wrapped in Convex's own "[Request ID: …] Server
 * Error" envelope. Matching is therefore substring-based on purpose.
 *
 * The mapping is deliberately COARSER than the server's: sign-in never says
 * which half of the pair was wrong, and password reset never says whether the
 * address has an account. Both are account-enumeration oracles, and an
 * unauthenticated caller can hit them at will.
 */

/** Which screen the error came from — it decides how vague the answer is. */
export type AuthStep = "signIn" | "signUp" | "resetRequest" | "resetVerify";

/**
 * True when the failure is "no account with that email address".
 *
 * The reset-request screen swallows exactly this one and reports success
 * anyway, because the whole point of that screen is that anyone may type any
 * address into it. Every OTHER failure is shown — a broken mail provider that
 * reported success would leave the user waiting for a code that is never
 * coming.
 */
export function isUnknownAccountError(err: unknown): boolean {
    return /InvalidAccountId/i.test(err instanceof Error ? err.message : "");
}

export function friendlyAuthError(err: unknown, step: AuthStep): string {
    const raw = err instanceof Error ? err.message : "";

    // Ordered most-specific first: the rate-limit identifier can accompany a
    // sign-in and a code check alike, so it has to win over both.
    if (/TooManyFailedAttempts/i.test(raw)) {
        return "Too many failed attempts. Wait a few minutes and try again.";
    }

    if (step === "resetVerify") {
        // The server answers a wrong code, an expired code, a code minted for
        // a different address and a rate-limited check with the same opaque
        // failure. Say the one thing that is true of all four.
        if (
            /InvalidAccountId|Invalid code|verify code|InvalidSecret/i.test(raw)
        ) {
            return "That code is not valid or has expired. Request a new one.";
        }
        if (/Invalid password/i.test(raw)) {
            return "Choose a longer password — at least 8 characters.";
        }
        return "Could not reset your password. Request a new code and try again.";
    }

    if (step === "resetRequest") {
        // `isUnknownAccountError` is filtered out before we get here; what is
        // left is a genuine send failure.
        return "Could not send the code. Try again in a moment.";
    }

    if (/InvalidAccountId/i.test(raw)) {
        return step === "signIn"
            ? "Invalid email or password"
            : "Could not create account";
    }
    if (/InvalidSecret|InvalidPassword/i.test(raw)) {
        return "Invalid email or password";
    }
    if (/AccountAlreadyExists|already exists/i.test(raw)) {
        return "An account with this email already exists";
    }
    return step === "signIn"
        ? "Sign-in failed. Check your credentials and try again."
        : "Sign-up failed. Please try again.";
}
