// One immutable JSON asset, fetched with a DEADLINE — the catalogue's packed
// corpus (`./catalogueArtifact`) and the deck-builder search index
// (`./searchIndex`) both arrive this way (issue #4861).

/**
 * How long one attempt may take before it becomes a REJECTION.
 *
 * `fetch` has no deadline of its own, and a request that never settles is the
 * worst shape a loader can take: the catalogue gate would sit on "Loading
 * cards..." with no Retry (its error branch renders on a rejection, and a
 * pending promise is not one) and the Brain's Worker would post nothing for
 * the rest of the session — every consult expiring on
 * `BRAIN_CONSULT_TIMEOUT_MS` and resolving `move: null`, i.e. a bot that
 * passes every window, which is exactly the issue #2450 symptom. A stall is
 * therefore turned into a rejection, which every caller already handles.
 * Generous on purpose — ~1 MB over a slow link is a real download, and this
 * bounds a STALL, not slowness.
 */
export const FETCH_TIMEOUT_MS = 60_000;

/** The parsed body at `url`; rejects on a stall, a non-OK status or a body
 *  that is not JSON, naming `what` and the URL. */
export async function fetchJsonAsset(
    url: string,
    what: string
): Promise<unknown> {
    // An explicit controller rather than `AbortSignal.timeout`: the deadline
    // has to be an ordinary `setTimeout` so it is one thing a test can drive
    // and one thing every runtime this module loads in already has.
    const controller = new AbortController();
    const deadline = setTimeout(() => {
        controller.abort(
            new Error(`${what} ${url} — no response in ${FETCH_TIMEOUT_MS} ms`)
        );
    }, FETCH_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(deadline);
    }
    if (!response.ok) {
        throw new Error(
            `${what} ${url} — HTTP ${response.status} ${response.statusText}`
        );
    }
    return (await response.json()) as unknown;
}
