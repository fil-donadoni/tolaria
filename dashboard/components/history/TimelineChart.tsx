import { Fragment } from "react";
import { fmtMetric } from "../../lib/format";
import { colorFor, OTHER } from "../../lib/historyColors";
import { OTHER_KEY, type TimelineShape } from "../../lib/historyTimeline";
import { barPath, niceTicks } from "../../lib/svg";
import { TimelinePoint } from "./TimelinePoint";
import { TimelineSegment } from "./TimelineSegment";

/**
 * The "Over time" chart (PRD #3148 S3) — stacked daily bars for a metric that
 * sums, one line per series for a metric that does not. Ported from
 * `scripts/dashboard/history-timeline.js` (#2625).
 *
 * The STATISTICS are decided in `historyTimeline.ts`; what is here is only the
 * geometry. The two rules worth restating where the marks are drawn:
 *
 * - GAPS STAY GAPS. A day with no rows for a series is not a zero, and joining
 *   the line across it would invent a measurement. So a segment is drawn only
 *   between CONSECUTIVE observed days.
 * - The 2px separator between stacked segments is made of BACKGROUND, not of a
 *   border drawn around each mark: a stroke would add width to the column and
 *   put a line between a bar and the axis it sits on.
 */

const GAP = 6;
const PAD_L = 68;
const PAD_R = 12;
const PAD_T = 10;
const AXIS_H = 42;
const PLOT_H = 260;

export function TimelineChart({
    shape,
    split,
    metric,
}: {
    shape: TimelineShape;
    split: string;
    metric: string;
}) {
    const { days, seriesKeys, stack, additive, max } = shape;
    // Wide enough to read, narrow enough that a year of days still fits the
    // card's own scroll container rather than shrinking to a smear.
    const barW = Math.max(
        9,
        Math.min(34, Math.floor(960 / Math.max(days.length, 1)))
    );
    const W = PAD_L + days.length * (barW + GAP) + PAD_R;
    const H = PAD_T + PLOT_H + AXIS_H;
    const ticks = niceTicks(max);
    const yTop = ticks[ticks.length - 1] || 1;
    const y = (v: number) => PAD_T + PLOT_H - (v / yTop) * PLOT_H;
    const cx = (i: number) => PAD_L + i * (barW + GAP) + barW / 2;
    const colour = (k: string) =>
        k === OTHER_KEY ? OTHER : colorFor(split, k);
    // A label per day up to 40; past that, one every `n`th so they do not
    // overlap into an unreadable band.
    const labelEvery = days.length <= 40 ? 1 : Math.ceil(days.length / 30);

    return (
        <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="group"
            aria-label={`Daily ${metric} by ${split}`}
        >
            {ticks.map((t) => (
                <Fragment key={`tick-${t}`}>
                    <line
                        x1={PAD_L - 6}
                        x2={W - PAD_R}
                        y1={y(t).toFixed(1)}
                        y2={y(t).toFixed(1)}
                        stroke="var(--border)"
                        strokeWidth="1"
                    />
                    <text
                        x={PAD_L - 10}
                        y={(y(t) + 4).toFixed(1)}
                        textAnchor="end"
                        fill="var(--muted-foreground)"
                        fontSize="11"
                    >
                        {fmtMetric(metric, t)}
                    </text>
                </Fragment>
            ))}

            {!additive
                ? seriesKeys.map((k) => {
                      const points = days
                          .map((d, i) => ({ i, d, v: stack.get(d)?.get(k) }))
                          .filter(
                              (p): p is { i: number; d: string; v: number } =>
                                  p.v != null
                          );
                      if (points.length === 0) return null;
                      const stroke = colour(k);
                      return (
                          <Fragment key={`series-${k}`}>
                              {points.map((p, j) =>
                                  j > 0 && points[j - 1].i === p.i - 1 ? (
                                      <line
                                          key={`seg-${p.d}`}
                                          x1={cx(points[j - 1].i).toFixed(1)}
                                          y1={y(points[j - 1].v).toFixed(1)}
                                          x2={cx(p.i).toFixed(1)}
                                          y2={y(p.v).toFixed(1)}
                                          stroke={stroke}
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                      />
                                  ) : null
                              )}
                              {points.map((p) => (
                                  <TimelinePoint
                                      key={`pt-${p.d}`}
                                      cx={cx(p.i)}
                                      cy={y(p.v)}
                                      color={stroke}
                                      day={p.d}
                                      series={k}
                                      metric={metric}
                                      value={p.v}
                                  />
                              ))}
                          </Fragment>
                      );
                  })
                : days.map((d, i) => {
                      const column = stack.get(d);
                      const present = seriesKeys.filter(
                          (k) => (column?.get(k) ?? 0) > 0
                      );
                      const dayTotal = present.reduce(
                          (s, k) => s + (column?.get(k) ?? 0),
                          0
                      );
                      let acc = 0;
                      return present.map((k, j) => {
                          const v = column?.get(k) ?? 0;
                          const y0 = y(acc + v);
                          const y1 = y(acc);
                          acc += v;
                          const h = Math.max(1, y1 - y0 - 2);
                          const x = PAD_L + i * (barW + GAP);
                          return (
                              <TimelineSegment
                                  key={`bar-${d}-${k}`}
                                  d={
                                      j === present.length - 1
                                          ? barPath(x, y0, barW, h, 4)
                                          : `M${x},${y0}h${barW}v${h}h${-barW}Z`
                                  }
                                  fill={colour(k)}
                                  day={d}
                                  series={k}
                                  metric={metric}
                                  value={v}
                                  dayTotal={dayTotal}
                              />
                          );
                      });
                  })}

            {days.map((d, i) =>
                i % labelEvery === 0 ? (
                    <text
                        key={`day-${d}`}
                        x={cx(i).toFixed(1)}
                        y={PAD_T + PLOT_H + 16}
                        textAnchor="end"
                        fill="var(--muted-foreground)"
                        fontSize="10"
                        transform={`rotate(-45 ${cx(i).toFixed(1)} ${PAD_T + PLOT_H + 16})`}
                    >
                        {d.slice(5)}
                    </text>
                ) : null
            )}

            <line
                x1={PAD_L - 6}
                x2={W - PAD_R}
                y1={PAD_T + PLOT_H}
                y2={PAD_T + PLOT_H}
                stroke="var(--border)"
                strokeWidth="1"
            />
        </svg>
    );
}
