/**
 * The first-party route the Sentry SDK posts its envelopes to (issue #10414).
 *
 * Content blockers and tracker lists name `*.ingest.sentry.io`, so a client
 * that posts there directly reports nothing from exactly the devices the
 * telemetry exists to watch (issue #10116: an iPhone behind AdLock sent zero
 * events; Sentry dropped none — they never left the page). The SDK's `tunnel`
 * option sends every envelope to a same-origin path instead, and the host
 * forwards the POST body unchanged to the project's envelope endpoint:
 *
 * - production: a Vercel rewrite in `vercel.json` (an external destination is
 *   proxied, body and method intact), listed BEFORE the SPA catch-all;
 * - local dev and `vite preview`: the same path on the Vite proxy
 *   (`vite.config.ts`), so dev keeps delivering as it did before.
 *
 * Sentry's ingest authenticates a tunnelled envelope by the DSN in its header,
 * so the forward carries no key of its own. The destination is fixed to this
 * project: the route cannot be used to post to anyone else's.
 *
 * The path is deliberately bland: a generic blocklist matches `/sentry`,
 * `/telemetry`, `/envelope`, so none of those words appear in it.
 *
 * Pure (no DOM, no imports): `vite.config.ts` loads it under Node.
 * `__tests__/sentry-tunnel.test.ts` holds `vercel.json` to these values.
 */
export const SENTRY_DSN =
    "https://82a4e88a462f5637f13141dc3b7a37d9@o4505113193218048.ingest.us.sentry.io/4511609765691393";

/** Same-origin path the SDK posts to (`Sentry.init({ tunnel })`). */
export const SENTRY_TUNNEL_PATH = "/diag/relay";

/**
 * The envelope endpoint a tunnel forwards to: `https://<host>/api/<project>/envelope/`,
 * derived from the DSN so the two cannot drift.
 */
export function sentryEnvelopeEndpoint(dsn: string): string {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!/^\d+$/.test(projectId)) {
        throw new Error(`sentry-tunnel: DSN has no numeric project id: ${dsn}`);
    }
    return `${url.protocol}//${url.host}/api/${projectId}/envelope/`;
}
