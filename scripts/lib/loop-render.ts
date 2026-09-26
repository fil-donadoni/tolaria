// The pure core behind the AFK terminal (PRD #4717, issue #4721, ADR 0147):
// one stamped line of `loop-afk.log` in, the lines an operator sees out.
//
// The log stays the record — plain stamped text, zero ANSI, written by `tee`
// BEFORE this module ever sees a line (`scripts/loop-handoff.sh`). The terminal
// is a rendered VIEW of it: a dim `HH:MM:SS` column, a fixed `│` gutter, glyphs
// in place of the `loop-drain:` / `loop-handoff:` source prefixes, a rule
// around each pass and a box around the run summary.
//
// Two contracts every later slice (sweep collapse, markdown, status line,
// `--watch`) extends rather than re-derives:
//
//   * CLASSIFICATION IS BY TAG, never by free-text regex. The driver writes a
//     closed set of tagged prefixes (`loop-drain[pass]: …`, see DRIVER_TAGS);
//     anything else is body text. A message may be reworded freely without
//     moving a line into a different class.
//   * THE DATE COMES FROM THE LINE, never from the clock. The stamp prefix is
//     the only time source, so a foreground run and a replay of the log
//     render identically.
//
// `render` is pure: state in, state out, no I/O. The stdin→stdout wrapper
// (`scripts/loop-render.ts`) owns TTY detection, `NO_COLOR` / `--plain` and
// terminal width.

/** The closed set of driver tags. A bracketed tag outside it is body text. */
export const DRIVER_TAGS = [
    "run",
    "warn",
    "error",
    "pass",
    "end",
    "sweep",
    "summary",
] as const;
export type DriverTag = (typeof DRIVER_TAGS)[number];

export interface RenderEnv {
    /** Terminal width in columns — rules and the summary box fill to it. */
    width: number;
    /** ANSI colour on/off. Off keeps the layout and drops every escape. */
    color: boolean;
}

export interface RenderState {
    /** `YYYY-MM-DD` of the last stamped line — a change prints a day rule. */
    day: string | null;
    /** `YYYY-MM-DD HH:MM:SS` of the last stamped line — a repeat blanks the time column. */
    stamp: string | null;
}

export const INITIAL_RENDER_STATE: RenderState = { day: null, stamp: null };

export interface RenderResult {
    output: string[];
    state: RenderState;
}

const STAMP_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ?(.*)$/s;
const SOURCE_RE = /^(loop-drain|loop-handoff)(?:\[([a-z]+)\])?: ?(.*)$/s;
const TIME_WIDTH = 8;
const GUTTER = " │ ";
const RULE_GUTTER = " ├─ ";
const BAR_CELLS = 10;

type Tone = "dim" | "bold" | "red" | "green" | "yellow" | "cyan";
const SGR: Record<Tone, string> = {
    dim: "2",
    bold: "1",
    red: "31",
    green: "32",
    yellow: "33",
    cyan: "36",
};

const paint = (env: RenderEnv, tone: Tone, text: string): string =>
    env.color && text !== "" ? `\x1b[${SGR[tone]}m${text}\x1b[0m` : text;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const visibleLength = (text: string): number =>
    [...text.replace(ANSI_RE, "")].length;

const isDriverTag = (tag: string): tag is DriverTag =>
    (DRIVER_TAGS as readonly string[]).includes(tag);

export type LineClass =
    | { kind: "tagged"; tag: DriverTag; message: string }
    | { kind: "info"; message: string }
    | { kind: "body"; text: string };

/** Classify a line's content (the part after the stamp) by its tag alone. */
export function classifyLine(content: string): LineClass {
    const m = SOURCE_RE.exec(content);
    if (!m) return { kind: "body", text: content };
    const [, , tag, message] = m;
    if (tag === undefined) return { kind: "info", message };
    if (isDriverTag(tag)) return { kind: "tagged", tag, message };
    return { kind: "body", text: content };
}

/** `k=v` pairs of a tagged message (`pass=3 exit=0 reason=- …`). */
export function parseFields(message: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const word of message.split(/\s+/)) {
        const eq = word.indexOf("=");
        if (eq > 0) fields[word.slice(0, eq)] = word.slice(eq + 1);
    }
    return fields;
}

const num = (value: string | undefined): number | null => {
    if (value === undefined || value === "" || !/^-?\d+(\.\d+)?$/.test(value))
        return null;
    return Number(value);
};

export function formatDuration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s}s`;
    if (s < 3600)
        return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
    const h = Math.floor(s / 3600);
    return `${h}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

export function formatTokens(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
    return String(Math.round(n));
}

/** Bar tone: yellow above 75% of the effective ceiling, red above 90%. */
export function budgetTone(ratio: number): Tone {
    if (ratio > 0.9) return "red";
    if (ratio > 0.75) return "yellow";
    return "green";
}

function spendBar(env: RenderEnv, fields: Record<string, string>): string {
    const spent = num(fields.spent);
    const ceiling = num(fields.ceiling) ?? num(fields.budget);
    if (spent === null || ceiling === null || ceiling <= 0) return "spend n/a";
    const ratio = spent / ceiling;
    const filled = Math.min(
        BAR_CELLS,
        Math.max(0, Math.round(ratio * BAR_CELLS))
    );
    const bar = "█".repeat(filled) + "░".repeat(BAR_CELLS - filled);
    return `${paint(env, budgetTone(ratio), bar)} ${formatTokens(spent)}/${formatTokens(ceiling)} ${Math.round(ratio * 100)}%`;
}

const queueMove = (from: string | undefined, to: string | undefined): string =>
    `queue ${from ?? "?"}→${to ?? "?"}`;

/** Pass outcome, from the pass-end `reason` field — the log row's own reason. */
export function passOutcome(
    env: RenderEnv,
    fields: Record<string, string>
): string {
    const reason = fields.reason ?? "?";
    const retry = num(fields.retry);
    switch (reason) {
        case "-":
            return paint(env, "green", "✓ done");
        case "claude-retry":
            return paint(
                env,
                "red",
                `✗ crashed · retry in ${formatDuration(retry ?? 0)}`
            );
        case "claude-error":
            return paint(env, "red", "✗ crashed · stopping");
        case "claims-held-retry":
            return paint(env, "red", "✗ died holding claims · next pass reaps");
        case "claims-held":
            return paint(env, "red", "✗ died holding claims · stopping");
        case "rate-limit":
            return paint(env, "yellow", "⏸ rate-limited · stopping");
        case "budget":
            return paint(env, "yellow", "⏸ budget · stopping");
        case "no-progress":
            return paint(env, "yellow", "⏸ no progress · stopping");
        default:
            return paint(env, "red", `✗ ${reason}`);
    }
}

/** Run-summary reason tone: a clean stop green, a pause yellow, a fault red. */
function stopTone(reason: string): Tone {
    if (["queue-empty", "max-passes", "stop-file"].includes(reason))
        return "green";
    if (["budget", "rate-limit", "no-progress"].includes(reason))
        return "yellow";
    return "red";
}

/** A rule line: `├─ <label> ───…` filled with `─` to the terminal width. */
function rule(env: RenderEnv, time: string, label: string): string {
    const head = `${time}${paint(env, "dim", RULE_GUTTER)}${label} `;
    const fill = Math.max(1, env.width - visibleLength(head));
    return head + paint(env, "dim", "─".repeat(fill));
}

function passHeaderLabel(env: RenderEnv, message: string): string {
    const m = /^pass (\d+) — issue #(\d+) on tier (\S+?)\.?$/.exec(message);
    const text = m
        ? `pass ${m[1]} · #${m[2]} · ${m[3]}`
        : message.replace(/\.$/, "");
    return paint(env, "bold", text);
}

function passFooterLabel(env: RenderEnv, message: string): string {
    const f = parseFields(message);
    const duration = num(f.duration);
    return [
        passOutcome(env, f),
        duration === null ? null : formatDuration(duration),
        queueMove(f.queue_before, f.queue_after),
        spendBar(env, f),
    ]
        .filter((part): part is string => part !== null)
        .join(" · ");
}

function summaryBox(env: RenderEnv, message: string): string[] {
    const f = parseFields(message);
    const reason = f.reason ?? "unknown";
    const duration = num(f.duration);
    const rows = [
        `passes ${f.passes ?? "?"} · stopped: ${paint(env, stopTone(reason), reason)}`,
        `queue ${f.queue_start ?? "?"} → ${f.queue_end ?? "?"}`,
        spendBar(env, f),
    ];
    if (duration !== null) rows.push(`duration ${formatDuration(duration)}`);
    const title = " run summary ";
    const inner = Math.max(
        title.length + 1,
        ...rows.map((r) => visibleLength(r) + 2)
    );
    const d = (text: string) => paint(env, "dim", text);
    return [
        d("╭─") +
            paint(env, "bold", title) +
            d("─".repeat(inner - title.length - 1) + "╮"),
        ...rows.map(
            (r) =>
                `${d("│")} ${r}${" ".repeat(inner - visibleLength(r) - 2)} ${d("│")}`
        ),
        d(`╰${"─".repeat(inner)}╯`),
    ];
}

function glyphLine(env: RenderEnv, tag: DriverTag, message: string): string {
    switch (tag) {
        case "run":
            return `${paint(env, "bold", "▶")} ${message}`;
        case "warn":
            return paint(env, "yellow", `⚠ ${message}`);
        case "error":
            return paint(env, "red", `✗ ${message}`);
        case "sweep":
            return paint(env, "dim", `◌ ${message}`);
        default:
            return message;
    }
}

/**
 * Render ONE stamped line. Returns the lines to print and the next state.
 * Throws only on a programming error — the caller (`renderSafely`) turns a
 * throw into a raw passthrough rather than losing the line.
 */
export function render(
    state: RenderState,
    line: string,
    env: RenderEnv
): RenderResult {
    const stamped = STAMP_RE.exec(line);
    const output: string[] = [];
    let next = state;
    let time = " ".repeat(TIME_WIDTH);
    let content = line;
    if (stamped) {
        const [, day, clock, rest] = stamped;
        const stamp = `${day} ${clock}`;
        if (day !== state.day) {
            const label = `── ${day} `;
            output.push(
                paint(
                    env,
                    "dim",
                    label +
                        "─".repeat(
                            Math.max(1, env.width - visibleLength(label))
                        )
                )
            );
        }
        if (stamp !== state.stamp) time = paint(env, "dim", clock);
        next = { day, stamp };
        content = rest;
    }
    const gutter = paint(env, "dim", GUTTER);
    const blank = " ".repeat(TIME_WIDTH);
    const cls = classifyLine(content);
    if (cls.kind === "body") {
        output.push(`${time}${gutter}${cls.text}`.trimEnd());
    } else if (cls.kind === "info") {
        output.push(`${time}${gutter}${paint(env, "dim", "·")} ${cls.message}`);
    } else if (cls.tag === "pass") {
        output.push(rule(env, time, passHeaderLabel(env, cls.message)));
    } else if (cls.tag === "end") {
        output.push(rule(env, time, passFooterLabel(env, cls.message)));
    } else if (cls.tag === "summary") {
        summaryBox(env, cls.message).forEach((row, i) =>
            output.push(`${i === 0 ? time : blank}${gutter}${row}`)
        );
    } else {
        output.push(`${time}${gutter}${glyphLine(env, cls.tag, cls.message)}`);
    }
    return { output, state: next };
}

export interface SafeRenderResult extends RenderResult {
    /** Set when this line fell back to raw: the one stderr notice to print. */
    notice?: string;
}

/**
 * `render`, but a line that throws is printed RAW and the throw becomes a
 * `loop-render: degraded to plain — <err>` notice. A presentation bug never
 * costs the operator a line of the stream.
 */
export function renderSafely(
    state: RenderState,
    line: string,
    env: RenderEnv,
    renderLine: typeof render = render
): SafeRenderResult {
    try {
        return renderLine(state, line, env);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
            output: [line],
            state,
            notice: `loop-render: degraded to plain — ${reason}`,
        };
    }
}
