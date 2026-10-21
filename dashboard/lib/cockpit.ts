import { useEffect, useState } from "react";
import {
    parseCockpitReading,
    type CockpitReading,
} from "../../scripts/lib/cockpit-reading";
import { fmtInstant } from "./format";

/**
 * The page's one read (issue #5652): `GET /api/cockpit`, once per page load.
 * The reading is a snapshot `bun run cockpit` took; nothing on the page
 * polls, because nothing it shows moves faster than a re-run.
 */

export type CockpitState =
    | { status: "loading" }
    | { status: "ready"; reading: CockpitReading }
    | { status: "failed"; reason: string };

export const COCKPIT_ROUTE = "/api/cockpit";

/** The state one response leaves the page in. A reading this page cannot
 *  render (another version) is a failure that says so, never a blank. */
export async function readCockpit(
    fetchFn: typeof fetch = fetch
): Promise<CockpitState> {
    let res: Response;
    try {
        res = await fetchFn(COCKPIT_ROUTE);
    } catch (e) {
        return {
            status: "failed",
            reason: `the server did not answer: ${String(e)}`,
        };
    }
    const text = await res.text();
    if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try {
            const body = JSON.parse(text) as { error?: unknown };
            if (typeof body.error === "string") reason = body.error;
        } catch {
            // Not JSON: the status is all there is.
        }
        return { status: "failed", reason };
    }
    const reading = parseCockpitReading(text);
    return reading
        ? { status: "ready", reading }
        : {
              status: "failed",
              reason: "the reading is from another version of the cockpit — run: bun run cockpit",
          };
}

/** The header's line: when the reading was taken, the window it covers,
 *  which machine read it. */
export function readingMeta(r: CockpitReading): string {
    const parts = [`read ${fmtInstant(r.readAt)}`];
    if (r.trends)
        parts.push(
            `window ${r.trends.window.from.slice(0, 10)} → ${r.trends.window.to.slice(0, 10)}`
        );
    parts.push(`this machine: ${r.host}`);
    return parts.join(" · ");
}

export function useCockpit(): CockpitState {
    const [state, setState] = useState<CockpitState>({ status: "loading" });
    useEffect(() => {
        let live = true;
        void readCockpit().then((s) => {
            if (live) setState(s);
        });
        return () => {
            live = false;
        };
    }, []);
    return state;
}
