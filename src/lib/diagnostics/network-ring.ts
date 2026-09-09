/**
 * Failed BACKEND requests, bounded and reduced (issue #3256).
 *
 * A board snapshot cannot tell a dropped request from a bot that chose to do
 * nothing, and the reporter's own account of "it just stopped" cannot either.
 * This ring records the failures, and only the failures — a successful request
 * is not evidence and would drown the ones that are.
 *
 * REDUCED ON PURPOSE, at the point of capture rather than at the point of
 * sending: method, path SHAPE and status, and nothing else. No request body, no
 * response body, no query string, no headers. A body is where a token, a
 * decklist or another player's hidden information would be, and the way to
 * guarantee none of that travels is to never put it in the ring in the first
 * place — a redaction step at the end is a step someone can forget.
 */

export type FailedRequest = {
    /** HTTP method, upper-cased. */
    method: string;
    /** Pathname with anything id-shaped masked — see `pathShape`. */
    path: string;
    /** HTTP status, or 0 when the request never got one (a network error). */
    status: number;
    at: number;
};

/** Enough to show a run of failures — one 500 is an incident, ten in a row is a
 *  diagnosis — without letting a long broken session grow the report. */
export const NETWORK_RING_LIMIT = 40;

let failures: FailedRequest[] = [];

export function recordFailedRequest(record: Omit<FailedRequest, "at">): void {
    failures = [...failures, { ...record, at: Date.now() }].slice(
        -NETWORK_RING_LIMIT
    );
}

/** Pure read — never clears. */
export function getFailedRequests(): FailedRequest[] {
    return failures;
}

export function clearFailedRequests(): void {
    failures = [];
}

/**
 * A path segment survives only if it LOOKS LIKE A ROUTE WORD — an ALLOWLIST of
 * shape, in the same direction as the storage allowlist and for the same
 * reason. The first draft of this listed the id shapes to mask (digits, UUIDs,
 * long lower-case runs), which is a denylist: a mixed-case, dotted or
 * hyphenated token — a JWT or a base64url magic-link token sitting in a path —
 * did not match any of them and travelled unmasked.
 *
 * A route word starts with a letter and is SHORT — 15 characters, which fits
 * every segment this backend actually serves (`api`, `storage`, `mutation`,
 * `prepare_auth`, `sw-cards.js`) and fits no id or token: a Convex id is 32, a
 * UUID 36, a base64url token longer still. Everything else becomes `:id`, so
 * the SHAPE of the failing route survives and the instance never does.
 *
 * The cost of the rule being too strict is a masked path segment in one report;
 * the cost of it being too loose is a credential in a database row.
 */
const ROUTE_WORD = /^[A-Za-z][A-Za-z0-9._-]{0,14}$/;

function maskSegment(segment: string): string {
    if (segment === "") return segment;
    return ROUTE_WORD.test(segment) ? segment : ":id";
}

/** The path with its instance-identifying segments masked. Query string and
 *  fragment are dropped whole: a query is the other place a token hides. */
export function pathShape(url: string, base?: string): string {
    try {
        const parsed = new URL(url, base);
        return parsed.pathname.split("/").map(maskSegment).join("/");
    } catch {
        return "/unparseable";
    }
}

let installed = false;

/**
 * Wraps `fetch` and records the failures aimed at a backend.
 *
 * SCOPED, not global: only requests to the Convex deployment or to this app's
 * own origin are recorded. A failed image fetch from a card CDN is noise here,
 * and a third-party URL is exactly the kind of thing whose path should not be
 * copied into a database row.
 *
 * Idempotent, and it never changes what the caller sees: the original response
 * (or the original rejection) is returned unchanged, so installing this can
 * only add a record, never alter a request.
 */
export function installNetworkRing(backendUrl: string | undefined): () => void {
    if (installed || typeof window.fetch !== "function") return () => {};
    installed = true;

    const backendOrigin = safeOrigin(backendUrl);
    const original = window.fetch.bind(window);

    const isBackend = (url: string): boolean => {
        const origin = safeOrigin(url, window.location.href);
        if (!origin) return false;
        return origin === backendOrigin || origin === window.location.origin;
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
        const method = (
            init?.method ??
            (typeof input === "object" && "method" in input
                ? input.method
                : undefined) ??
            "GET"
        ).toUpperCase();
        try {
            const res = await original(input, init);
            if (!res.ok && isBackend(url)) {
                recordFailedRequest({
                    method,
                    path: pathShape(url, window.location.href),
                    status: res.status,
                });
            }
            return res;
        } catch (err) {
            if (isBackend(url)) {
                // Status 0 === the request never reached a status. That is a
                // different failure from a 500 and must not read as one.
                recordFailedRequest({
                    method,
                    path: pathShape(url, window.location.href),
                    status: 0,
                });
            }
            throw err;
        }
    };

    return () => {
        window.fetch = original;
        installed = false;
    };
}

function safeOrigin(url: string | undefined, base?: string): string | null {
    if (!url) return null;
    try {
        return new URL(url, base).origin;
    } catch {
        return null;
    }
}
