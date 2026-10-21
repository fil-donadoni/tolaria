/**
 * The cockpit's formatting vocabulary (issue #5652). Every export is a total
 * function of its arguments: no DOM, no fetch, no module-level state. A
 * missing figure prints `–`, never `0` — "not measured" is not "none".
 */

import type { Spread } from "../../scripts/lib/workflow-trends";

export const MISSING = "–";

export function fmtNum(n: number | null | undefined, digits = 0): string {
    if (n == null || !Number.isFinite(n)) return MISSING;
    return n.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

export function fmtUsd(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return MISSING;
    return n >= 100
        ? `$${Math.round(n).toLocaleString("en-US")}`
        : `$${n.toFixed(2)}`;
}

/** A percentage already in 0–100. */
export const fmtPct = (n: number | null | undefined): string =>
    n == null || !Number.isFinite(n) ? MISSING : `${n.toFixed(0)} %`;

/** A ratio in 0–1, as a percentage. */
export const fmtRatio = (r: number | null | undefined): string =>
    r == null ? MISSING : fmtPct(100 * r);

/** `median / p90`, or `–` with no value. */
export function fmtSpread(
    s: Pick<Spread, "median" | "p90"> | null | undefined,
    fmt: (n: number | null) => string
): string {
    if (!s || s.median === null) return MISSING;
    return `${fmt(s.median)} / ${fmt(s.p90)}`;
}

/** A signed count: `+12`, `−3`, `0`. */
export const fmtSigned = (n: number): string =>
    n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";

/** `2026-10-21 14:03` UTC — the reading's clock, never the viewer's zone. */
export const fmtInstant = (iso: string): string =>
    `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export const GITHUB_REPO = "fil-donadoni/tolaria";

export const issueUrl = (n: number): string =>
    `https://github.com/${GITHUB_REPO}/issues/${n}`;

export const pullUrl = (n: number): string =>
    `https://github.com/${GITHUB_REPO}/pull/${n}`;

export const commitUrl = (sha: string): string =>
    `https://github.com/${GITHUB_REPO}/commit/${sha}`;
