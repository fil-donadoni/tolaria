import { useSyncExternalStore } from "react";

/**
 * The one line under the page title (PRD #3148 S3).
 *
 * It states what the telemetry STORE holds — row counts, the day range, the
 * last ingest — or why it could not be read. That makes it History's sentence,
 * written by History's bootstrap; but it is rendered in the header, which is
 * chrome, and chrome is statically reachable from the React entry.
 *
 * So it is a STORE and not a prop. The header subscribes; the lazily-imported
 * History chunk publishes. Nothing in this file names a route or reads a
 * payload, so the module carries no store-backed edge into the Now graph —
 * which is the property `telemetry-serve.test.ts` crawls for.
 *
 * It replaces `document.getElementById("meta-line").textContent = …`, written
 * from two places in the vanilla code: `history-boot.js` on success and
 * `main.js`'s catch on failure.
 */

let line = "loading…";
const listeners = new Set<() => void>();

export const getMetaLine = (): string => line;

export function setMetaLine(next: string): void {
    line = next;
    for (const fn of listeners) fn();
}

export function subscribeToMetaLine(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
}

export const useMetaLine = (): string =>
    useSyncExternalStore(subscribeToMetaLine, getMetaLine);

/** Test-only: back to the pre-bootstrap wording. */
export function resetMetaLine(): void {
    line = "loading…";
    listeners.clear();
}
