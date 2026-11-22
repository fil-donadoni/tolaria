import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    SENTRY_DSN,
    SENTRY_TUNNEL_PATH,
    sentryEnvelopeEndpoint,
} from "../sentry-tunnel";

// Issue #10414: the SDK posts to a same-origin path and the host forwards it.
// In production that forward is a `vercel.json` rewrite, a static file this
// module cannot import — so this test holds the two together. A rewrite that
// drifts from the path (or lands after the SPA catch-all, which would answer
// the POST with `index.html`) silences every report and nothing else notices.

interface Rewrite {
    source: string;
    destination: string;
}

function vercelRewrites(): Rewrite[] {
    const file = path.resolve(__dirname, "../../../../vercel.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as {
        rewrites: Rewrite[];
    };
    return config.rewrites;
}

describe("Sentry tunnel (issue #10414)", () => {
    it("derives the project's envelope endpoint from the DSN", () => {
        expect(sentryEnvelopeEndpoint(SENTRY_DSN)).toBe(
            "https://o4505113193218048.ingest.us.sentry.io/api/4511609765691393/envelope/"
        );
    });

    it("refuses a DSN without a numeric project id", () => {
        expect(() =>
            sentryEnvelopeEndpoint("https://key@o1.ingest.sentry.io/")
        ).toThrow(/project id/);
    });

    it("vercel.json forwards the tunnel path to that endpoint, before the SPA catch-all", () => {
        const rewrites = vercelRewrites();
        const tunnel = rewrites.findIndex(
            (r) => r.source === SENTRY_TUNNEL_PATH
        );
        const catchAll = rewrites.findIndex((r) => r.source === "/(.*)");
        expect(tunnel).toBeGreaterThanOrEqual(0);
        expect(rewrites[tunnel].destination).toBe(
            sentryEnvelopeEndpoint(SENTRY_DSN)
        );
        expect(catchAll === -1 || tunnel < catchAll).toBe(true);
    });
});
