// The cockpit's reading as the page receives it (issue #5652): the payload
// `scripts/cockpit.ts` writes, `scripts/telemetry-serve.ts` serves and
// `dashboard/` renders. Types and one parse, no imports but types — the page
// bundles this file, so nothing here may reach Node.

import type { Trends } from "./workflow-trends";

export type RunnerState = "idle" | "busy" | "offline";

export interface RunnerView {
    name: string;
    /** The `host:<name>` label's name, or `null` without one. */
    host: string | null;
    /** `pass`, `lane`, `seed` — the labels a job asks for. */
    roles: string[];
    state: RunnerState;
}

/** The page's payload. Its version moves when its shape does. */
export interface CockpitReading {
    version: 1;
    /** When `bun run cockpit` read it. */
    readAt: string;
    /** This machine's host, as its runners declare it. */
    host: string;
    /** The weekly report's trends over the window ending at `readAt`, or
     *  `null` when GitHub could not be read (`errors` says why). */
    trends: Trends | null;
    /** GitHub's runners, or `null` when unreadable. */
    runners: RunnerView[] | null;
    /** One line per source that could not be read. */
    errors: string[];
}

/** A reading off disk, or `null` for anything this page cannot render. */
export function parseCockpitReading(text: string): CockpitReading | null {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Partial<CockpitReading>;
    if (r.version !== 1 || typeof r.readAt !== "string") return null;
    if (r.trends !== null && r.trends?.version !== 2) return null;
    return r as CockpitReading;
}
