import { describe, it, expect, beforeEach } from "vitest";
import {
    CLIENT_PREF_KEYS,
    CLIENT_PREF_PREFIX,
    collectClientPreferences,
    isAllowedPrefKey,
} from "../client-preferences";

// issue #3256 — the security constraint IS the feature here.
//
// `@convex-dev/auth` keeps its session token and its long-lived REFRESH token
// in the same `localStorage` these preferences live in. A collector that
// iterated storage instead of iterating the allowlist would put a reusable
// credential into a database row rendered as an expandable JSON tree — and the
// failure would be silent, because nothing about a wholesale dump looks wrong
// until someone reads the tree.

/** The real key names `@convex-dev/auth` writes (`react/client.js`), plus the
 *  namespaced form it actually stores them under. */
const AUTH_KEYS = [
    "__convexAuthJWT",
    "__convexAuthRefreshToken",
    "__convexAuthOAuthVerifier",
    "https://example.convex.cloud::__convexAuthRefreshToken",
];

describe("client-preferences allowlist (issue #3256)", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("cannot carry an auth token, even one stored beside an allowed key", () => {
        for (const key of AUTH_KEYS) {
            localStorage.setItem(key, "eyJhbGciOi.SECRET.token");
        }
        localStorage.setItem("tolaria:aiDifficulty", "hard");

        const prefs = collectClientPreferences();

        expect(prefs).toEqual({ "tolaria:aiDifficulty": "hard" });
        const dumped = JSON.stringify(prefs);
        for (const key of AUTH_KEYS) {
            expect(dumped).not.toContain(key);
        }
        expect(dumped).not.toContain("SECRET");
    });

    // A prefix rule alone would license a future `tolaria:`-namespaced secret;
    // a list alone would license a typo pointing at someone else's namespace.
    // Both gates, always.
    it("is a prefix AND an explicit list, not either one", () => {
        for (const key of CLIENT_PREF_KEYS) {
            expect(key.startsWith(CLIENT_PREF_PREFIX)).toBe(true);
            expect(isAllowedPrefKey(key)).toBe(true);
        }
        // Right prefix, not listed.
        expect(isAllowedPrefKey("tolaria:somethingAddedLater")).toBe(false);
        // Listed name, wrong namespace.
        expect(isAllowedPrefKey("other:aiDifficulty")).toBe(false);
        expect(isAllowedPrefKey("__convexAuthRefreshToken")).toBe(false);
    });

    it("does not carry an unknown tolaria: key added later", () => {
        localStorage.setItem("tolaria:somethingAddedLater", "hello");
        expect(collectClientPreferences()).toBeUndefined();

        localStorage.setItem("tolaria:playMode", "solo");
        expect(collectClientPreferences()).toEqual({
            "tolaria:playMode": "solo",
        });
    });

    // Empty must mean ABSENT: a report from a fresh browser must not carry
    // scaffolding that reads as "we looked and there was nothing".
    it("is absent when no allowed preference is set", () => {
        expect(collectClientPreferences()).toBeUndefined();
    });

    it("clamps a preference long enough not to be one", () => {
        localStorage.setItem("tolaria:selectedDeckId", "x".repeat(500));
        const prefs = collectClientPreferences();
        expect(prefs?.["tolaria:selectedDeckId"]?.length).toBe(201);
    });
});
