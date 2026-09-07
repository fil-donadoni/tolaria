import { ActivityHour } from "./ActivityHour";
import { fmtClockMs, fmtTokens } from "../../lib/format";
import {
    ACTIVITY_WINDOW_HOURS,
    niceCeiling,
    type ActivityRow,
} from "../../lib/nowActivity";

/**
 * The hourly chart (issue #3135, ported in PRD #3148 S2) — output tokens as
 * bars, PRs merged as a line over them, on the same 24-hour axis the timeline
 * above it uses.
 *
 * TWO AXES, deliberately: tokens run to hundreds of thousands and merges to
 * tens, so a shared scale would flatten the merge line onto the baseline. The
 * right-hand axis steps in whole PRs — half a merge is not a thing.
 *
 * Colours come from the dashboard's own chart tokens, so the chart themes
 * itself in light and dark with no variant at this call site.
 */

const W = 960;
const PAD_L = 62;
const PAD_R = 46;
const PAD_T = 14;
const PLOT_H = 150;
const AXIS_H = 28;
const H = PAD_T + PLOT_H + AXIS_H;

export function ActivityChart({ rows }: { rows: ActivityRow[] }) {
    const n = rows.length;
    const slot = (W - PAD_L - PAD_R) / n;
    const barW = Math.max(4, slot * 0.62);
    const tokTop = niceCeiling(Math.max(0, ...rows.map((r) => r.outTok)));
    const mergeTop = Math.max(
        1,
        niceCeiling(Math.max(0, ...rows.map((r) => r.merged)))
    );
    const yTok = (v: number) => PAD_T + PLOT_H - (v / tokTop) * PLOT_H;
    const yMerge = (v: number) => PAD_T + PLOT_H - (v / mergeTop) * PLOT_H;
    const cx = (i: number) => PAD_L + i * slot + slot / 2;
    const mergeSteps = Math.min(4, mergeTop);

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            className="min-w-[720px]"
            role="group"
            aria-label={`Output tokens and merged pull requests per hour, last ${ACTIVITY_WINDOW_HOURS} hours`}
        >
            {/* Grid + left axis (tokens), four steps. */}
            {[0, 1, 2, 3, 4].map((k) => {
                const v = (tokTop * k) / 4;
                const y = yTok(v);
                return (
                    <g key={`tok-${k}`}>
                        <line
                            x1={PAD_L - 4}
                            x2={W - PAD_R}
                            y1={y.toFixed(1)}
                            y2={y.toFixed(1)}
                            stroke="var(--border)"
                            strokeWidth="1"
                        />
                        <text
                            x={PAD_L - 8}
                            y={(y + 4).toFixed(1)}
                            textAnchor="end"
                            fill="var(--muted-foreground)"
                            fontSize="11"
                        >
                            {fmtTokens(v)}
                        </text>
                    </g>
                );
            })}

            {/* Right axis (merges) — integer steps only. */}
            {Array.from({ length: mergeSteps + 1 }, (_, k) => {
                const v = Math.round((mergeTop * k) / mergeSteps);
                return (
                    <text
                        key={`merge-${k}`}
                        x={W - PAD_R + 8}
                        y={(yMerge(v) + 4).toFixed(1)}
                        textAnchor="start"
                        fill="var(--chart-2)"
                        fontSize="11"
                    >
                        {v}
                    </text>
                );
            })}

            {rows.map((r, i) => {
                const y = yTok(r.outTok);
                const h = Math.max(r.outTok > 0 ? 2 : 0, PAD_T + PLOT_H - y);
                return (
                    <rect
                        key={`bar-${r.hourStart}`}
                        x={(cx(i) - barW / 2).toFixed(1)}
                        y={(PAD_T + PLOT_H - h).toFixed(1)}
                        width={barW.toFixed(1)}
                        height={h.toFixed(1)}
                        rx="2"
                        fill="var(--chart-1)"
                    />
                );
            })}

            <polyline
                points={rows
                    .map(
                        (r, i) =>
                            `${cx(i).toFixed(1)},${yMerge(r.merged).toFixed(1)}`
                    )
                    .join(" ")}
                fill="none"
                stroke="var(--chart-2)"
                strokeWidth="2"
                strokeLinejoin="round"
            />
            {rows.map((r, i) =>
                r.merged > 0 ? (
                    <circle
                        key={`dot-${r.hourStart}`}
                        cx={cx(i).toFixed(1)}
                        cy={yMerge(r.merged).toFixed(1)}
                        r="4"
                        fill="var(--chart-2)"
                        stroke="var(--card)"
                        strokeWidth="2"
                    />
                ) : null
            )}

            <line
                x1={PAD_L - 4}
                x2={W - PAD_R}
                y1={PAD_T + PLOT_H}
                y2={PAD_T + PLOT_H}
                stroke="var(--border)"
                strokeWidth="1"
            />
            {/* A label every three hours, anchored so the newest hour always
                gets one — the axis reads right-to-left from "now". */}
            {rows.map((r, i) =>
                i % 3 === n % 3 ? (
                    <text
                        key={`label-${r.hourStart}`}
                        x={cx(i).toFixed(1)}
                        y={PAD_T + PLOT_H + 18}
                        textAnchor="middle"
                        fill="var(--muted-foreground)"
                        fontSize="11"
                    >
                        {fmtClockMs(r.hourStart)}
                    </text>
                ) : null
            )}

            {/* Hit targets LAST, so they sit above everything. */}
            {rows.map((r, i) => (
                <ActivityHour
                    key={`hit-${r.hourStart}`}
                    row={r}
                    x={PAD_L + i * slot}
                    y={PAD_T}
                    width={slot}
                    height={PLOT_H}
                />
            ))}
        </svg>
    );
}
