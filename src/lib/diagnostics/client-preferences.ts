/**
 * The client preferences a bug report may carry — an ALLOWLIST, and the reason
 * it must be one (issue #3256).
 *
 * `@convex-dev/auth` keeps its session token AND its long-lived refresh token
 * in this same browser storage (`__convexAuthJWT`, `__convexAuthRefreshToken`).
 * A wholesale dump would therefore place a reusable credential into a database
 * row that the maintainer's report viewer renders as an expandable JSON tree.
 * That is account-takeover material, and no consent screen can make it
 * acceptable: a reporter cannot meaningfully agree to hand over their
 * credentials in order to debug a game bug.
 *
 * A DENYLIST is not an acceptable mitigation. It is a list that goes stale the
 * first time the auth library renames a key, and its failure mode is silent —
 * the credential simply starts travelling and nothing says so. An allowlist
 * fails the other way: a key nobody listed is a key nobody sends, and the cost
 * of the mistake is a missing preference in one report.
 *
 * TWO independent gates, both of which must pass: the key starts with
 * {@link CLIENT_PREF_PREFIX}, and the key is in {@link CLIENT_PREF_KEYS}. The
 * prefix alone would let a future `tolaria:`-namespaced secret through; the
 * list alone would let a typo point at someone else's namespace.
 */

/** Every key this app owns is namespaced. Gate one. */
export const CLIENT_PREF_PREFIX = "tolaria:";

/**
 * Gate two: the exact keys that may travel. All of them are innocuous, and all
 * of them change what the bot or the UI does — which is the only reason to send
 * a preference at all. Deliberately EXACT keys and not key prefixes: a
 * `tolaria:deckViewPrefs:` family rule would silently license whatever someone
 * later stores under that family.
 */
export const CLIENT_PREF_KEYS: readonly string[] = [
    "tolaria:aiDifficulty",
    "tolaria:aiDeckId",
    "tolaria:playMode",
    "tolaria:selectedDeckId",
    "tolaria:matchFormat",
    "tolaria:deckFormatFilter",
    "tolaria:deckViewPrefs:grouping:main",
    "tolaria:deckViewPrefs:ordering:main",
    "tolaria:skipPhasePrefs:v1",
];

/** Whether one key may be read into a bug report. Both gates, in one place, so
 *  no caller can pass one and skip the other. */
export function isAllowedPrefKey(key: string): boolean {
    return key.startsWith(CLIENT_PREF_PREFIX) && CLIENT_PREF_KEYS.includes(key);
}

/**
 * The allowed preferences that are actually set, or `undefined` when none are.
 *
 * Iterates the ALLOWLIST and asks storage for each key — never iterates storage
 * and filters. The direction matters: a filter over `localStorage.key(i)` is
 * one bad predicate away from a wholesale dump, and this loop cannot reach a
 * key that is not written above it.
 *
 * Values are clamped: a preference is a short scalar, and anything long enough
 * to need clamping is not the preference this list thought it was listing.
 */
export function collectClientPreferences(): Record<string, string> | undefined {
    const prefs: Record<string, string> = {};
    for (const key of CLIENT_PREF_KEYS) {
        if (!isAllowedPrefKey(key)) continue;
        let value: string | null = null;
        try {
            value = localStorage.getItem(key);
        } catch {
            // A browser with storage blocked has no preferences to report; it
            // must not cost the reporter the rest of the payload.
            return undefined;
        }
        if (value !== null) {
            prefs[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
        }
    }
    return Object.keys(prefs).length > 0 ? prefs : undefined;
}
