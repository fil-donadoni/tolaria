import { Fragment, useMemo } from "react";
import { Section } from "../Section";
import { Unavailable } from "../Unavailable";
import { EmptyNote } from "../EmptyNote";
import { fmtMetric } from "../../lib/format";
import type { HistoryChartData } from "../../lib/historyData";
import { GLOSSARY, labelFor } from "../../glossary";
import { RankingBar } from "./RankingBar";

/**
 * The "Ranking" card (PRD #3148 S3) — the top values of the current split,
 * descending. Ported from `scripts/dashboard/history-ranking.js` (#2625).
 *
 * ZERO-VALUED ROWS ARE DROPPED, not drawn at 2px: a bar of the minimum width
 * says "a little", and "none" is a different statement. Eighteen rows is the
 * cut, carried over — past that the card stops being a ranking and starts
 * being the table below it.
 *
 * The width is a fixed viewBox rather than a measurement of `innerWidth`. The
 * vanilla chart read the window ONCE, at render, so a resize left it at the
 * previous width until the next refresh; a viewBox scales with its container
 * for free and is what the Now view's chart already does.
 */

const ROW_H = 26;
const PAD_L = 168;
const PAD_R = 90;
const PAD_T = 6;
const W = 1000;
const TOP_N = 18;

export function RankingCard({
    charts,
    error,
}: {
    charts: HistoryChartData | null;
    error: string | null;
}) {
    const data = useMemo(() => {
        if (!charts) return [];
        const { bySplit, split, metric } = charts;
        return bySplit
            .map((r) => ({
                key: String(r[split] ?? ""),
                value: Number(r[metric] ?? 0),
            }))
            .filter((d) => d.value > 0)
            .slice(0, TOP_N);
    }, [charts]);

    const metricLabel = charts
        ? labelFor(charts.metric, charts.table)
        : "this metric";
    const splitLabel = charts ? labelFor(charts.split, charts.table) : "";
    const H = PAD_T + data.length * ROW_H + 8;
    const max = Math.max(...data.map((d) => d.value), 0);
    const barMax = W - PAD_L - PAD_R;

    return (
        <Section
            title={charts ? `${metricLabel} by ${splitLabel}` : "Ranking"}
            meta={`${GLOSSARY["card.ranking"].tip} Top ${TOP_N}, descending.`}
        >
            {error ? (
                <Unavailable
                    reason={`could not read the ranked rows: ${error}`}
                    consequence="Which values lead on this metric is unknown for this slice."
                />
            ) : data.length === 0 ? (
                <EmptyNote>
                    Every value of this split is zero on the current metric and
                    date range.
                </EmptyNote>
            ) : (
                <div className="overflow-x-auto">
                    <svg
                        width={W}
                        height={H}
                        viewBox={`0 0 ${W} ${H}`}
                        className="min-w-[560px]"
                        role="group"
                        aria-label={`${metricLabel} by ${splitLabel}, ranked`}
                    >
                        {data.map((d, i) => {
                            const y = PAD_T + i * ROW_H;
                            const w = (d.value / max) * barMax;
                            return (
                                <Fragment key={d.key}>
                                    <text
                                        x={PAD_L - 10}
                                        y={y + 15}
                                        textAnchor="end"
                                        fill="var(--muted-foreground)"
                                        fontSize="12"
                                    >
                                        {d.key.slice(0, 26)}
                                    </text>
                                    <RankingBar
                                        x={PAD_L}
                                        y={y}
                                        width={w}
                                        label={d.key}
                                        metric={charts!.metric}
                                        value={d.value}
                                    />
                                    {/* Direct value labels: the light palette
                                        has slots under 3:1 against the
                                        surface, so a bar cannot be the only
                                        carrier of its own magnitude. */}
                                    <text
                                        x={PAD_L + Math.max(2, w) + 8}
                                        y={y + 15}
                                        fill="var(--foreground)"
                                        fontSize="12"
                                    >
                                        {fmtMetric(charts!.metric, d.value)}
                                    </text>
                                </Fragment>
                            );
                        })}
                    </svg>
                </div>
            )}
        </Section>
    );
}
