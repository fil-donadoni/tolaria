// The password-reset OTP provider (`convex/resendOtpPasswordReset.ts`).
//
// Three things carry security weight and are pinned here: the code is
// uniformly distributed over ALL ten digits (a `% 10` on a raw byte is not),
// the code is bound to the address it was minted for, and a Resend failure
// propagates rather than looking like a delivered mail.
//
// No `vi.mock`/`vi.stubGlobal` on purpose — the `node` vitest project runs
// `isolate: false`, so a stubbed `fetch` or `process.env` would leak into
// every other file sharing the worker. `sendResetCodeEmail` takes its `fetch`
// and its API key as arguments for exactly that reason.
import { describe, it, expect } from "vitest";
import {
    CODE_DIGITS,
    CODE_TTL_SECONDS,
    ResendOTPPasswordReset,
    authorizeReset,
    formatCode,
    generateNumericCode,
    normalizeEmail,
    sendResetCodeEmail,
    type ResetMailDeps,
} from "../resendOtpPasswordReset";
import type { GenericDoc } from "@convex-dev/auth/server";
import type { GenericDataModel } from "convex/server";

type AuthAccount = GenericDoc<GenericDataModel, "authAccounts">;

/** The one field `authorizeReset` reads; the rest of the doc is irrelevant. */
function accountFor(providerAccountId: string): AuthAccount {
    return { providerAccountId } as unknown as AuthAccount;
}

function okResponse(): Response {
    return { ok: true, status: 200, text: async () => "" } as Response;
}

describe("generateNumericCode", () => {
    it("is always CODE_DIGITS decimal digits, leading zeros kept", () => {
        for (let i = 0; i < 200; i++) {
            const code = generateNumericCode();
            expect(code).toMatch(new RegExp(`^[0-9]{${CODE_DIGITS}}$`));
        }
    });

    it("reaches every digit 0-9", () => {
        // 400 codes = 3200 digits. What this catches is an alphabet that is
        // not the ten decimal digits — a `% 6`, a hex nibble, a truncated
        // range. It does NOT catch the 26/256-vs-25/256 skew that dropping
        // the rejection-sampling guard would introduce: that bias is far too
        // small to separate from sampling noise without a chi-square over a
        // sample size no unit test should pay for. The guard stands on
        // reading, not on this assertion.
        const seen = new Set<string>();
        for (let i = 0; i < 400; i++) {
            for (const d of generateNumericCode()) seen.add(d);
        }
        expect([...seen].sort().join("")).toBe("0123456789");
    });

    it("does not repeat itself across draws", () => {
        const codes = new Set(
            Array.from({ length: 200 }, () => generateNumericCode())
        );
        // 200 draws from 10^8: a collision is a ~0.02% event, a constant
        // generator is a 199-collision certainty.
        expect(codes.size).toBeGreaterThan(195);
    });
});

describe("normalizeEmail", () => {
    it("trims and lowercases so both sides of the flow agree", () => {
        expect(normalizeEmail("  Planeswalker@Example.COM ")).toBe(
            "planeswalker@example.com"
        );
    });

    it("maps a non-string to the empty string", () => {
        expect(normalizeEmail(undefined)).toBe("");
        expect(normalizeEmail(42)).toBe("");
    });
});

describe("formatCode", () => {
    it("groups the digits 4+4 for reading off a screen", () => {
        expect(formatCode("12345678")).toBe("1234 5678");
    });
});

describe("authorizeReset — the code is bound to one address", () => {
    it("accepts the address the code was minted for", async () => {
        await expect(
            authorizeReset(
                { email: "pilot@example.com" },
                accountFor("pilot@example.com")
            )
        ).resolves.toBeUndefined();
    });

    it("accepts it regardless of the case the client typed", async () => {
        await expect(
            authorizeReset(
                { email: " Pilot@Example.com " },
                accountFor("pilot@example.com")
            )
        ).resolves.toBeUndefined();
    });

    it("rejects a code presented with a different address", async () => {
        await expect(
            authorizeReset(
                { email: "attacker@example.com" },
                accountFor("pilot@example.com")
            )
        ).rejects.toThrow(/does not match/i);
    });

    it("rejects a bare code with no address at all", async () => {
        await expect(
            authorizeReset({}, accountFor("pilot@example.com"))
        ).rejects.toThrow(/requires an `email`/);
    });
});

describe("sendResetCodeEmail", () => {
    it("posts the code to Resend with the bearer key and the recipient", async () => {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        const deps: ResetMailDeps = {
            apiKey: "re_test_key",
            from: "Tolaria <no-reply@tolaria.test>",
            fetchImpl: (async (url: string, init: RequestInit) => {
                calls.push({ url, init });
                return okResponse();
            }) as unknown as typeof fetch,
        };

        await sendResetCodeEmail(deps, "pilot@example.com", "12345678");

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://api.resend.com/emails");
        expect(
            (calls[0].init.headers as Record<string, string>).Authorization
        ).toBe("Bearer re_test_key");

        const body = JSON.parse(calls[0].init.body as string);
        expect(body.to).toEqual(["pilot@example.com"]);
        expect(body.from).toBe("Tolaria <no-reply@tolaria.test>");
        // The code reaches the reader in both parts a mail client may render.
        expect(body.text).toContain("1234 5678");
        expect(body.html).toContain("1234 5678");
        expect(body.subject).toContain("1234 5678");
        expect(body.text).toContain(`${CODE_TTL_SECONDS / 60} minutes`);
    });

    it("throws, and sends nothing, when the deployment has no API key", async () => {
        let called = false;
        const deps: ResetMailDeps = {
            apiKey: undefined,
            from: "Tolaria <no-reply@tolaria.test>",
            fetchImpl: (async () => {
                called = true;
                return okResponse();
            }) as unknown as typeof fetch,
        };

        await expect(
            sendResetCodeEmail(deps, "pilot@example.com", "12345678")
        ).rejects.toThrow(/RESEND_API_KEY is not set/);
        expect(called).toBe(false);
    });

    it("propagates a Resend rejection instead of reporting a delivered mail", async () => {
        const deps: ResetMailDeps = {
            apiKey: "re_test_key",
            from: "Tolaria <no-reply@tolaria.test>",
            fetchImpl: (async () =>
                ({
                    ok: false,
                    status: 403,
                    text: async () => '{"message":"domain is not verified"}',
                }) as Response) as unknown as typeof fetch,
        };

        await expect(
            sendResetCodeEmail(deps, "pilot@example.com", "12345678")
        ).rejects.toThrow(/403.*domain is not verified/s);
    });
});

describe("the provider config handed to Password({ reset })", () => {
    it("overrides `Email()`'s hardcoded id and one-hour maxAge", () => {
        // Both are literals inside `Email()`; spreading it and then setting
        // them is the only way to change either, so this is what would
        // silently regress if the spread order were ever flipped.
        expect(ResendOTPPasswordReset.id).toBe("resend-otp-password-reset");
        expect(ResendOTPPasswordReset.maxAge).toBe(CODE_TTL_SECONDS);
        expect(ResendOTPPasswordReset.maxAge).not.toBe(60 * 60);
    });

    it("mints its own numeric token rather than the library's alphanumeric one", async () => {
        const token = await ResendOTPPasswordReset.generateVerificationToken!();
        expect(token).toMatch(new RegExp(`^[0-9]{${CODE_DIGITS}}$`));
    });

    it("keeps the address check — the code alone is not a credential", () => {
        expect(ResendOTPPasswordReset.authorize).toBe(authorizeReset);
    });
});
