// The bench's order statistics (issue #9527): nearest-rank percentiles, the
// ones every table in `brain-search-off-the-dev-machine.md` quotes.

const sorted = (values) => [...values].sort((a, b) => a - b);

/** Nearest-rank `p`th percentile of `values`; NaN when there are none. */
export function percentile(values, p) {
    if (values.length === 0) return NaN;
    const s = sorted(values);
    return s[
        Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length))) - 1
    ];
}

export const median = (values) => percentile(values, 50);
