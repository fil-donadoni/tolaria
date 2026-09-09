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

/** A segment that carries no information a maintainer can use, and might carry
 *  information they should not have: Convex ids, UUIDs, storage ids, numbers.
 *  Masked to `:id` so the SHAPE of the failing route survives and the instance
 *  does not. */
function maskSegment(segment: string): string {
    if (segment === "") return segment;
    if (/^\d+$/.test(segment)) return ":id";
    if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            segment
        )
    ) {
        return ":id";
    }
    // Convex ids and storage ids are long, lower-case alphanumeric and carry no
    // separator — the shape nothing human-readable in this app has.
    if (/^[a-z0-9]{16,}$/.test(segment)) return ":id";
    return segment;
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
