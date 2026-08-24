/**
 * Password-reset email provider: an 8-digit OTP delivered by Resend.
 *
 * Wired into `convex/auth.ts` as the `reset` option of the `Password`
 * provider, which turns on two extra values of its `flow` param:
 *
 *   1. `flow: "reset"` with `{ email }` — looks the account up, mints a code,
 *      and calls `sendVerificationRequest` below. Returns `{ started: true }`.
 *   2. `flow: "reset-verification"` with `{ email, code, newPassword }` —
 *      verifies the code, rewrites the password hash, invalidates every other
 *      session and signs the caller in on the spot.
 *
 * WHY OTP AND NOT A MAGIC LINK: a code needs no public route outside
 * `<AuthGate>` and no token in a URL that mail clients pre-fetch, unfurl and
 * log. The trade is that the code alone is not a credential — `authorizeReset`
 * re-checks that the email presented at verification is the one the code was
 * minted for, so a leaked code is useless without the address.
 *
 * BRUTE FORCE: `@convex-dev/auth` rate-limits code verification per identifier
 * (`authRateLimits`, 10 failed attempts/hour by default, applied inside
 * `verifyCodeAndSignIn`). Ten guesses an hour against 10^8 codes that expire
 * in fifteen minutes is not a search anyone finishes.
 *
 * REQUIRED CONVEX DEPLOYMENT ENV VARS (`npx convex env set …`):
 *   - `RESEND_API_KEY`  — Resend API key.
 *   - `SITE_URL`        — required by @convex-dev/auth itself: the email flow
 *                         builds a redirect URL before it ever calls us, and
 *                         `requireEnv("SITE_URL")` throws when it is unset.
 *   - `AUTH_EMAIL_FROM` — optional. Defaults to Resend's shared sandbox
 *                         sender, which can ONLY deliver to the address that
 *                         owns the Resend account. Set it to a verified
 *                         domain sender before real users exist.
 */
import { Email } from "@convex-dev/auth/providers/Email";
import type { EmailConfig } from "@convex-dev/auth/server";
import type { GenericDoc } from "@convex-dev/auth/server";
import type { GenericDataModel } from "convex/server";
import type { Value } from "convex/values";

/** Digits in the emailed code. 10^8 space; see `CODE_TTL_SECONDS`. */
export const CODE_DIGITS = 8;

/**
 * 15 minutes. Short enough that grinding the code space is hopeless against
 * the library's 10-attempts-per-hour limiter, long enough to survive a slow
 * mail hop. The library default for an email provider is a full hour —
 * deliberately overridden.
 */
export const CODE_TTL_SECONDS = 15 * 60;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Resend's shared sandbox sender — delivers only to the account owner. */
const DEFAULT_FROM = "Tolaria <onboarding@resend.dev>";

/**
 * The address form both sides of the flow agree on.
 *
 * `authAccounts.providerAccountId` is written from `profile()` in
 * `convex/auth.ts`, which lowercases and trims. The code path that verifies an
 * OTP compares that stored id against the raw `params.email` the client sent,
 * so anything reaching either side unnormalised is a spurious "Invalid code".
 * Normalising here too makes the check independent of what the client typed.
 */
export function normalizeEmail(raw: unknown): string {
    return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * A uniformly-distributed `CODE_DIGITS`-digit decimal code, zero-padded.
 *
 * `crypto.getRandomValues` (Convex's V8 runtime has it), not `Math.random`,
 * and rejection sampling rather than `% 10` per byte — a raw modulo biases
 * digits 0-5 over 6-9, which shrinks the effective search space.
 */
export function generateNumericCode(): string {
    const digits: string[] = [];
    const buffer = new Uint8Array(CODE_DIGITS * 2);
    while (digits.length < CODE_DIGITS) {
        crypto.getRandomValues(buffer);
        for (const byte of buffer) {
            if (digits.length === CODE_DIGITS) break;
            // 250 == 25 * 10: bytes at or above it would bias the low digits.
            if (byte >= 250) continue;
            digits.push(String(byte % 10));
        }
    }
    return digits.join("");
}

/** Human-facing code grouping: `12345678` → `1234 5678`. */
export function formatCode(code: string): string {
    return `${code.slice(0, 4)} ${code.slice(4)}`;
}

function resetEmailText(code: string): string {
    return [
        "Reset your Tolaria password",
        "",
        `Your verification code is ${formatCode(code)}`,
        "",
        `The code expires in ${CODE_TTL_SECONDS / 60} minutes and can be used once.`,
        "If you did not ask to reset your password, ignore this email — nothing has changed.",
    ].join("\n");
}

function resetEmailHtml(code: string): string {
    return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#12100c;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8e1d1;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">
      <tr><td>
        <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#e8e1d1;">Reset your Tolaria password</h1>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#a9a08c;">Enter this code to choose a new password.</p>
        <p style="margin:0 0 24px;padding:16px 24px;background:#1d1a14;border:1px solid #3b342a;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;letter-spacing:6px;text-align:center;color:#e8e1d1;">${formatCode(code)}</p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#a9a08c;">The code expires in ${CODE_TTL_SECONDS / 60} minutes and can be used once.</p>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#a9a08c;">If you did not ask to reset your password, ignore this email — nothing has changed.</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * Everything `sendResetCodeEmail` reads from the outside world.
 *
 * Passed in rather than read from module scope so the function is testable
 * without stubbing `globalThis.fetch` or `process.env`: the `node` vitest
 * project runs `isolate: false`, so a global written by one file is a global
 * every other file in that worker inherits.
 */
export interface ResetMailDeps {
    fetchImpl: typeof fetch;
    apiKey: string | undefined;
    from: string;
}

/** POST one reset code to Resend. Throws with a diagnosable message. */
export async function sendResetCodeEmail(
    deps: ResetMailDeps,
    email: string,
    code: string
): Promise<void> {
    if (!deps.apiKey) {
        throw new Error(
            "RESEND_API_KEY is not set on this Convex deployment — password " +
                "reset cannot send mail. Set it with: " +
                "npx convex env set RESEND_API_KEY <key>"
        );
    }

    const response = await deps.fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${deps.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from: deps.from,
            to: [email],
            subject: `Your Tolaria password reset code: ${formatCode(code)}`,
            text: resetEmailText(code),
            html: resetEmailHtml(code),
        }),
    });

    if (!response.ok) {
        // Resend answers with a JSON `{ name, message }` on failure. Surface
        // it: a swallowed 403 here is indistinguishable, from the client, from
        // a code that simply never arrived.
        const detail = await response.text().catch(() => "");
        throw new Error(
            `Resend rejected the password-reset email (${response.status}): ${detail}`
        );
    }
}

/**
 * Binds a code to the address it was minted for.
 *
 * Runs before the code is checked. Without it the OTP alone would be a bearer
 * credential for whichever account it was issued against.
 */
export async function authorizeReset(
    params: Record<string, Value | undefined>,
    account: GenericDoc<GenericDataModel, "authAccounts">
): Promise<void> {
    const presented = normalizeEmail(params.email);
    if (presented.length === 0) {
        throw new Error("Verifying a reset code requires an `email`.");
    }
    if (normalizeEmail(account.providerAccountId) !== presented) {
        throw new Error("Reset code does not match this email address.");
    }
}

/**
 * The `reset` email provider handed to `Password({ reset })`.
 *
 * `Email()` supplies the OTP-shaped defaults (type `"email"`, and an
 * `authorize` that binds the code to an address); `id` and `maxAge` are
 * hardcoded inside it, so both are overridden here rather than passed in.
 */
export const ResendOTPPasswordReset: EmailConfig = {
    ...Email({
        sendVerificationRequest: async ({ identifier: email, token }) => {
            await sendResetCodeEmail(
                {
                    fetchImpl: fetch,
                    apiKey: process.env.RESEND_API_KEY,
                    from: process.env.AUTH_EMAIL_FROM ?? DEFAULT_FROM,
                },
                email,
                token
            );
        },
    }),
    id: "resend-otp-password-reset",
    maxAge: CODE_TTL_SECONDS,
    generateVerificationToken: () => Promise.resolve(generateNumericCode()),
    authorize: authorizeReset,
};
