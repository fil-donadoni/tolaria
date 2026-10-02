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
    /** `https://github.com/<owner>/<repo>`, resolved from the git remote by
     * the wrapper (`scripts/loop-render.ts`) — never derived here, `render`
     * stays pure I/O-free. `undefined` when the remote can't be resolved: a
     * `#N` / `issue #N` / `PR #N` reference still highlights, it just isn't
     * wrapped in an OSC 8 link (issue #4719). */
    repoUrl?: string;
}

/** A sweep block being buffered — its header seen, its rows not yet closed
 * off by the next non-body line. Nothing is emitted while this is set (issue
 * #4718): the decision to print in full or collapse needs the WHOLE block,
 * which streams in as several separately-stamped lines. */
interface PendingSweep {
    /** The header line's own day rule (0 or 1 line) and time cell, replayed
     * on flush whichever way the block resolves. */
    dayRule: string[];
    time: string;
    /** The sweep tag's message (`"orphan-claim sweep —"` or the `[dry-run]`
     * variant) — NOT part of the collapse signature (issue #4718: only the
     * `(issue, marker)` rows and the counts are). */
    message: string;
    /** Raw row contents (post-stamp, pre-render) — the signature is parsed
     * from these. */
    rows: string[];
    /** Each row already rendered (coloured, gutter'd) for the FULL case,
     * 1:1 with `rows`, any row-level day rule folded in inline. */
    rowLines: string[];
}

/** The normalised sweep — the set of `(issue, marker)` rows plus the
 * claimed/orphaned/recoverable counts. Claim ages and free-text reasons are
 * excluded by construction: this is parsed only from the fields that carry
 * them (issue #4718 / PRD #4717). */
export interface SweepSignature {
    rows: { mark: string; issue: number }[];
    claimed: number;
    orphaned: number;
    recoverable: number;
}

export interface RenderState {
    /** `YYYY-MM-DD` of the last stamped line — a change prints a day rule. */
    day: string | null;
    /** `YYYY-MM-DD HH:MM:SS` of the last stamped line — a repeat blanks the time column. */
    stamp: string | null;
    /** The sweep block currently being buffered, or `null` between sweeps. */
    pendingSweep: PendingSweep | null;
    /** The last COMPLETED sweep's signature, for the next one to compare
     * against. `null` before a run's first sweep — which is therefore always
     * full. */
    lastSweep: SweepSignature | null;
    /** Inside a fenced code block (odd number of ``` lines seen so far in a
     * body run) — every line in it, fence included, passes through raw
     * (issue #4719): no bold/code/bullet/ref markdown, no wrapping. */
    inCodeFence: boolean;
}

export const INITIAL_RENDER_STATE: RenderState = {
    day: null,
    stamp: null,
    pendingSweep: null,
    lastSweep: null,
    inCodeFence: false,
};

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

export type Tone = "dim" | "bold" | "red" | "green" | "yellow" | "cyan";
const SGR: Record<Tone, string> = {
    dim: "2",
    bold: "1",
    red: "31",
    green: "32",
    yellow: "33",
    cyan: "36",
};

export const paint = (env: RenderEnv, tone: Tone, text: string): string =>
    env.color && text !== "" ? `\x1b[${SGR[tone]}m${text}\x1b[0m` : text;

/** An OSC 8 hyperlink (`ESC ] 8 ; ; url ST text ESC ] 8 ; ; ST`), or `text`
 * bare when colour is off or no repo URL was resolved (issue #4719): a link
 * is a visual affordance the same as SGR colour, gated the same way — "with
 * colour off, no escape sequences are emitted, OSC 8 included." */
const link = (env: RenderEnv, url: string | undefined, text: string): string =>
    env.color && url !== undefined
        ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`
        : text;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g;
export const visibleLength = (text: string): number =>
    [...text.replace(ANSI_RE, "")].length;

const isDriverTag = (tag: string): tag is DriverTag =>
    (DRIVER_TAGS as readonly string[]).includes(tag);

export type LineClass =
    | { kind: "tagged"; tag: DriverTag; message: string }
    | { kind: "info"; message: string }
    | { kind: "body"; text: string };

/** A log line's content — the part after its `YYYY-MM-DD HH:MM:SS` stamp,
 *  or the whole line when it carries none. */
export function stripStamp(line: string): string {
    const m = STAMP_RE.exec(line);
    return m ? m[3] : line;
}

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

/** The pass-START tag's trailing `session=<uuid>` word (issue #4722) —
 *  split off before the header is read, so the header regex never has to
 *  know about it. */
export function splitPassSession(message: string): {
    message: string;
    session: string | null;
} {
    const m = /^(.*?) session=(\S+)$/s.exec(message);
    return m ? { message: m[1], session: m[2] } : { message, session: null };
}

function passHeaderLabel(env: RenderEnv, raw: string): string {
    const { message, session } = splitPassSession(raw);
    const m = /^pass (\d+) — issue #(\d+) on tier (\S+?)\.?$/.exec(message);
    const text = m
        ? `pass ${m[1]} · #${m[2]} · ${m[3]}`
        : message.replace(/\.$/, "");
    // The id's first block is enough to find the transcript by eye; the
    // log row carries it whole.
    const tail = session ? ` ${paint(env, "dim", session.slice(0, 8))}` : "";
    return paint(env, "bold", text) + tail;
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

/** A sweep roster row (`  · #4352 title…  reason` / `  ! #4352 …`), issue
 * #4718: mark + issue number, which is all the signature keeps — the title
 * and the free-text reason (which carries the claim age) are read but
 * discarded. */
const SWEEP_ROW_RE = /^ {2}([·!×?~]) #(\d+)\b/;
/** `loop-doctor.ts`'s own count line — the one line that carries claimed and
 * orphaned. */
const SWEEP_COUNT_RE =
    /^(\d+) claimed, (\d+) orphaned \(nothing is going to release them\)\.$/;
/** `loop-doctor.ts`'s RECOVERABLE header — the one line that carries that
 * count (the roster rows already carry the `!` marks themselves). */
const SWEEP_RECOVERABLE_RE = /^(\d+) RECOVERABLE —/;

/** Parse a sweep block's buffered raw rows into its collapse signature. A
 * row/line this cannot place (a released/FAILED line, a "nothing claimed"
 * message, a recoverable resume hint, a blank separator) contributes nothing
 * — deliberately: none of them are part of the `(issue, marker)` + counts
 * signature (issue #4718). */
function parseSweepSignature(rows: string[]): SweepSignature {
    const parsed: { mark: string; issue: number }[] = [];
    let claimed = 0;
    let orphaned = 0;
    let recoverable = 0;
    for (const text of rows) {
        const rowM = SWEEP_ROW_RE.exec(text);
        if (rowM) {
            parsed.push({ mark: rowM[1], issue: Number(rowM[2]) });
            continue;
        }
        const countM = SWEEP_COUNT_RE.exec(text);
        if (countM) {
            claimed = Number(countM[1]);
            orphaned = Number(countM[2]);
            continue;
        }
        const recM = SWEEP_RECOVERABLE_RE.exec(text);
        if (recM) recoverable = Number(recM[1]);
    }
    // A SET, not a sequence (PRD #4717) — the doctor's own row order is
    // already stable, but sorting makes the comparison order-independent on
    // principle rather than by accident.
    parsed.sort((a, b) => a.issue - b.issue || a.mark.localeCompare(b.mark));
    return { rows: parsed, claimed, orphaned, recoverable };
}

/** Same claimed/orphaned/recoverable counts and the same `(issue, marker)`
 * set — ages and reasons never reach a `SweepSignature`, so there is nothing
 * left to ignore here. */
function sameSweep(a: SweepSignature, b: SweepSignature): boolean {
    return (
        a.claimed === b.claimed &&
        a.orphaned === b.orphaned &&
        a.recoverable === b.recoverable &&
        a.rows.length === b.rows.length &&
        a.rows.every(
            (r, i) => r.mark === b.rows[i].mark && r.issue === b.rows[i].issue
        )
    );
}

/** `sweep unchanged · 2 claimed · 0 orphaned · 1 recoverable (#4352)` — the
 * recoverable issue numbers are read off the `!` rows themselves (deduped:
 * `loop-doctor.ts` prints each recoverable issue twice, once in the roster
 * and once in its own resume block), never off the discarded free text. */
function collapsedSweepText(sig: SweepSignature): string {
    const ids = [
        ...new Set(sig.rows.filter((r) => r.mark === "!").map((r) => r.issue)),
    ];
    const recoverablePart =
        ids.length > 0
            ? `${sig.recoverable} recoverable (${ids.map((n) => `#${n}`).join(", ")})`
            : `${sig.recoverable} recoverable`;
    return `sweep unchanged · ${sig.claimed} claimed · ${sig.orphaned} orphaned · ${recoverablePart}`;
}

/** Recoverable (`!`) rows render yellow, informational (`·`) rows dim — the
 * actionable row stands out (issue #4718). Any other mark, or a line that is
 * not a roster row at all, renders plain. */
function colorSweepRow(env: RenderEnv, text: string): string {
    const m = SWEEP_ROW_RE.exec(text);
    if (!m) return text;
    // `~` = stranded (issue #4763): actionable like `!`.
    if (m[1] === "!" || m[1] === "~") return paint(env, "yellow", text);
    if (m[1] === "·") return paint(env, "dim", text);
    return text;
}

/** A body line's own rendering rule (bare gutter for an empty line, gutter +
 * text otherwise), factored out so a buffered sweep row renders exactly like
 * an ordinary body line, just with an optional colour override. */
function bodyLine(
    env: RenderEnv,
    time: string,
    text: string,
    colorFn?: (env: RenderEnv, text: string) => string
): string {
    if (text === "") return `${time}${paint(env, "dim", GUTTER.trimEnd())}`;
    const gutter = paint(env, "dim", GUTTER);
    return `${time}${gutter}${colorFn ? colorFn(env, text) : text}`;
}

// --- Pass-summary markdown (issue #4719) -----------------------------------
//
// `claude` writes each pass's own summary as plain markdown body lines
// (`- **Test:** …`, `  - nested …`, a bare issue/PR ref). This is deliberately
// NOT a full parser — only the markdown that passes actually emit: bold,
// inline code, two bullet levels, `#N`/`issue #N`/`PR #N` references, and
// fenced code blocks / tables passed through verbatim.

const CODE_SPAN_RE = /`([^`]+)`/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const REF_RE = /(\b(?:pr|issue)\s)?#(\d+)\b/gi;
const FENCE_RE = /^\s*```/;
/** A markdown table row — this repo's own tables (`CLAUDE.md`,
 * `gre-development.md`) are always `| cell | cell |`, header and separator
 * rows included, so one regex covers both. */
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
/** Two bullet levels only (issue #4719's acceptance list): no indent → `•`,
 * exactly two spaces → `◦`. Anything deeper reads as body text. */
const BULLET_RE = /^( {2})?- (.*)$/;

/** `**bold**` and `#N` / `issue #N` / `PR #N` references, applied to one
 * NON-CODE segment of a line. Never called on a code span's own content —
 * inline code is verbatim, same as real markdown: a stray `**` inside
 * `` `a**b` `` must not pair up with a later REAL `**bold**` marker on the
 * same line and corrupt it (PR #4745 review finding). */
function renderTextSegment(env: RenderEnv, text: string): string {
    let out = text.replace(BOLD_RE, (_, inner: string) =>
        paint(env, "bold", inner)
    );
    out = out.replace(REF_RE, (_, kind: string | undefined, n: string) => {
        const label = `${kind ?? ""}#${n}`;
        const path = kind?.trim().toLowerCase() === "pr" ? "pull" : "issues";
        const url = env.repoUrl ? `${env.repoUrl}/${path}/${n}` : undefined;
        return link(env, url, paint(env, "cyan", label));
    });
    return out;
}

/** `` `code` `` splits a line into code spans and everything else; the
 * spans are painted verbatim and never handed to `renderTextSegment` —
 * bold/ref markup is looked for only in what is left, so a reference
 * textually inside a `**bold #12**` span still renders (the DSL here is
 * line-oriented, not a nested tree), but a `**` living inside a code span
 * never reaches the bold pass at all. */
function renderInlineMarkdown(env: RenderEnv, text: string): string {
    let out = "";
    let last = 0;
    CODE_SPAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CODE_SPAN_RE.exec(text)) !== null) {
        out += renderTextSegment(env, text.slice(last, m.index));
        out += paint(env, "cyan", m[1]);
        last = CODE_SPAN_RE.lastIndex;
    }
    out += renderTextSegment(env, text.slice(last));
    return out;
}

/** Word-wrap already-rendered (ANSI/OSC 8 included) text to `width` visible
 * columns, breaking only on spaces — no hyphenation, and a single word wider
 * than `width` still gets its own line rather than being cut mid-character. */
function wrapWords(words: string[], width: number): string[] {
    const lines: string[] = [];
    let cur: string[] = [];
    let curLen = 0;
    for (const w of words) {
        const wLen = visibleLength(w);
        const sep = cur.length > 0 ? 1 : 0;
        if (cur.length > 0 && curLen + sep + wLen > width) {
            lines.push(cur.join(" "));
            cur = [w];
            curLen = wLen;
        } else {
            cur.push(w);
            curLen += sep + wLen;
        }
    }
    if (cur.length > 0) lines.push(cur.join(" "));
    return lines;
}

/** Render one markdown body line: bold/code/refs plus width-aware wrapping
 * with a hanging indent under the gutter and the bullet (issue #4719). A
 * fenced code block (every line from an opening ``` to the matching closing
 * one) or a table row passes through untouched and unwrapped — table columns
 * and code are pre-formatted by whoever wrote them. */
function markdownBodyLines(
    env: RenderEnv,
    time: string,
    text: string,
    inCodeFence: boolean
): { lines: string[]; inCodeFence: boolean } {
    if (text === "") return { lines: [bodyLine(env, time, text)], inCodeFence };
    const fenceToggle = FENCE_RE.test(text);
    if (inCodeFence || fenceToggle || TABLE_ROW_RE.test(text)) {
        return {
            lines: [bodyLine(env, time, text)],
            inCodeFence: fenceToggle ? !inCodeFence : inCodeFence,
        };
    }
    const bulletM = BULLET_RE.exec(text);
    const nested = bulletM?.[1] !== undefined;
    const indentWidth = bulletM ? (nested ? 4 : 2) : 0;
    const bulletPrefix = bulletM
        ? `${bulletM[1] ?? ""}${nested ? "◦" : "•"} `
        : "";
    const content = bulletM ? bulletM[2] : text;
    const rendered = renderInlineMarkdown(env, content);
    const available = Math.max(
        1,
        env.width - TIME_WIDTH - visibleLength(GUTTER) - indentWidth
    );
    const wrapped = wrapWords(rendered.split(" "), available);
    const gutter = paint(env, "dim", GUTTER);
    const blank = " ".repeat(TIME_WIDTH);
    const indentSpaces = " ".repeat(indentWidth);
    return {
        lines: wrapped.map(
            (ln, i) =>
                `${i === 0 ? time : blank}${gutter}${i === 0 ? bulletPrefix : indentSpaces}${ln}`
        ),
        inCodeFence: false,
    };
}

/** The day rule (0 or 1 line) and time cell for ONE stamped line, plus the
 * content past the stamp and the state it advances to. Pulled out of
 * `render` so a buffered sweep row can compute the exact same cells the
 * un-buffered path would have, without duplicating the stamp parsing. */
function stampLine(
    state: RenderState,
    line: string,
    env: RenderEnv
): { content: string; time: string; dayRule: string[]; next: RenderState } {
    const stamped = STAMP_RE.exec(line);
    if (!stamped)
        return {
            content: line,
            time: " ".repeat(TIME_WIDTH),
            dayRule: [],
            next: state,
        };
    const [, day, clock, rest] = stamped;
    const stamp = `${day} ${clock}`;
    const dayRule: string[] = [];
    if (day !== state.day) {
        const label = `── ${day} `;
        dayRule.push(
            paint(
                env,
                "dim",
                label +
                    "─".repeat(Math.max(1, env.width - visibleLength(label)))
            )
        );
    }
    const time =
        stamp !== state.stamp
            ? paint(env, "dim", clock)
            : " ".repeat(TIME_WIDTH);
    return { content: rest, time, dayRule, next: { ...state, day, stamp } };
}

/** Resolve a completed sweep block: full (header + every row, day rule
 * included) when this is the run's first sweep, when it differs from the
 * last one, or when it released an orphan — collapsed to one line
 * otherwise. Either way the block's OWN signature becomes `lastSweep`, so
 * the next block compares against what actually printed, not against
 * whichever way this one rendered (issue #4718). */
function flushSweep(
    pending: PendingSweep,
    lastSweep: SweepSignature | null,
    env: RenderEnv
): { output: string[]; signature: SweepSignature } {
    const signature = parseSweepSignature(pending.rows);
    const unchanged =
        signature.orphaned === 0 &&
        lastSweep !== null &&
        sameSweep(signature, lastSweep);
    if (unchanged) {
        const gutter = paint(env, "dim", GUTTER);
        const line = `${pending.time}${gutter}${paint(env, "dim", `◌ ${collapsedSweepText(signature)}`)}`;
        return { output: [...pending.dayRule, line], signature };
    }
    const gutter = paint(env, "dim", GUTTER);
    const header = `${pending.time}${gutter}${glyphLine(env, "sweep", pending.message)}`;
    return {
        output: [...pending.dayRule, header, ...pending.rowLines],
        signature,
    };
}

/**
 * Render ONE stamped line. Returns the lines to print and the next state.
 * Throws only on a programming error — the caller (`renderSafely`) turns a
 * throw into a raw passthrough rather than losing the line.
 *
 * A `sweep`-tagged line opens a buffered block instead of printing (issue
 * #4718): nothing is emitted until the block CLOSES — the next line that is
 * not plain body text — because the full/collapsed choice needs the whole
 * block, which arrives as several separately-stamped lines. `flushPending`
 * closes a block still open when the stream itself ends.
 */
export function render(
    state: RenderState,
    line: string,
    env: RenderEnv
): RenderResult {
    const { content, time, dayRule, next } = stampLine(state, line, env);
    const cls = classifyLine(content);

    if (state.pendingSweep) {
        if (cls.kind === "body") {
            const rendered = bodyLine(env, time, cls.text, colorSweepRow);
            return {
                output: [],
                state: {
                    ...next,
                    pendingSweep: {
                        ...state.pendingSweep,
                        rows: [...state.pendingSweep.rows, cls.text],
                        rowLines: [
                            ...state.pendingSweep.rowLines,
                            ...dayRule,
                            rendered,
                        ],
                    },
                },
            };
        }
        // The block just closed. Flush it, then render THIS line fresh —
        // against the ORIGINAL state (before this call's own `stampLine`
        // advanced it), never `next`: a second `stampLine` off an already-
        // advanced stamp would see its own line as a repeat and blank a
        // time cell that must show — rather than treat the line as sweep
        // content.
        const flush = flushSweep(state.pendingSweep, state.lastSweep, env);
        const rest = render(
            { ...state, pendingSweep: null, lastSweep: flush.signature },
            line,
            env
        );
        return { output: [...flush.output, ...rest.output], state: rest.state };
    }

    if (cls.kind === "tagged" && cls.tag === "sweep") {
        return {
            output: [],
            state: {
                ...next,
                pendingSweep: {
                    dayRule,
                    time,
                    message: cls.message,
                    rows: [],
                    rowLines: [],
                },
            },
        };
    }

    const gutter = paint(env, "dim", GUTTER);
    const blank = " ".repeat(TIME_WIDTH);
    const output: string[] = [...dayRule];
    let nextInCodeFence = next.inCodeFence;
    if (cls.kind === "body") {
        const md = markdownBodyLines(env, time, cls.text, next.inCodeFence);
        output.push(...md.lines);
        nextInCodeFence = md.inCodeFence;
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
    return { output, state: { ...next, inCodeFence: nextInCodeFence } };
}

/**
 * Flush a sweep block still buffered when the stream itself ends — the log
 * had no more lines to close it with. A no-op when nothing is pending.
 */
export function flushPending(state: RenderState, env: RenderEnv): RenderResult {
    if (!state.pendingSweep) return { output: [], state };
    const flush = flushSweep(state.pendingSweep, state.lastSweep, env);
    return {
        output: flush.output,
        state: { ...state, pendingSweep: null, lastSweep: flush.signature },
    };
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
