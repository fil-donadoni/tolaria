// The AFK terminal renderer's pure core (issue #4721, ADR 0147): stamped
// `loop-afk.log` lines in, rendered lines out. External behaviour only — the
// state object is threaded through, never inspected.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    INITIAL_RENDER_STATE,
    budgetTone,
    classifyLine,
    flushPending,
    render,
    renderSafely,
    visibleLength,
    type RenderEnv,
} from "../lib/loop-render";
import { parseRemoteUrl } from "../loop-render";

const PLAIN: RenderEnv = { width: 60, color: false };
const COLOR: RenderEnv = { width: 60, color: true };
/** Wide enough that the longest footer still ends in a `─` fill. */
const WIDE: RenderEnv = { width: 120, color: false };
const FIXTURES = path.join(__dirname, "fixtures", "loop-render");

/** Render a sequence of lines from the initial state, flattened. */
const renderAll = (lines: string[], env: RenderEnv = PLAIN): string[] => {
    let state = INITIAL_RENDER_STATE;
    const out: string[] = [];
    for (const line of lines) {
        const r = render(state, line, env);
        state = r.state;
        out.push(...r.output);
    }
    return out;
};

/** The last rendered line of a sequence — the one under test. */
const last = (lines: string[], env: RenderEnv = PLAIN): string =>
    renderAll(lines, env).at(-1) ?? "";

const S = "2026-09-26 10:00:00 ";
const end = (fields: string) => `${S}loop-drain[end]: ${fields}`;

describe("classifyLine — by tag, never by message text", () => {
    it.each([
        ["loop-drain[run]: run 1-2 — budget 5", "tagged", "run"],
        ["loop-drain[warn]: anything at all", "tagged", "warn"],
        ["loop-drain[error]: anything at all", "tagged", "error"],
        ["loop-drain[pass]: pass 3 — issue #1 on tier opus.", "tagged", "pass"],
        ["loop-drain[end]: pass=3 exit=0", "tagged", "end"],
        ["loop-drain[sweep]: orphan-claim sweep —", "tagged", "sweep"],
        ["loop-drain[summary]: passes=1", "tagged", "summary"],
        ["loop-handoff[warn]: WARNING — x", "tagged", "warn"],
        // An untagged source prefix is driver chatter, whatever it says —
        // a message that merely LOOKS like a warning stays chatter.
        ["loop-drain: WARNING — budget guard tripped", "info", undefined],
        ["loop-handoff: every pass will run", "info", undefined],
        // A bracket outside the closed set is not a tag.
        ["loop-drain[bogus]: hello", "body", undefined],
        ["- **Issue:** issue #4517", "body", undefined],
        ["loop:doctor — no claimed issues.", "body", undefined],
    ])("%s → %s %s", (content, kind, tag) => {
        const cls = classifyLine(content);
        expect(cls.kind).toBe(kind);
        if (tag !== undefined) expect(cls).toMatchObject({ tag });
    });
});

describe("time column and gutter", () => {
    it("prints a day rule before the first line, then HH:MM:SS │ message", () => {
        expect(renderAll([`${S}hello`])).toEqual([
            `── 2026-09-26 ${"─".repeat(60 - 14)}`,
            "10:00:00 │ hello",
        ]);
    });

    it("leaves the time column blank when a line repeats the previous stamp", () => {
        expect(renderAll([`${S}one`, `${S}two`]).slice(1)).toEqual([
            "10:00:00 │ one",
            "         │ two",
        ]);
    });

    it("prints the time again once the stamp moves", () => {
        expect(last([`${S}one`, "2026-09-26 10:00:01 two"])).toBe(
            "10:00:01 │ two"
        );
    });

    it("prints a new day rule when the date changes, and only then", () => {
        const out = renderAll([
            "2026-09-26 23:59:59 late",
            "2026-09-27 00:00:00 early",
            "2026-09-27 00:00:01 later",
        ]);
        expect(out.filter((l) => l.startsWith("── "))).toEqual([
            `── 2026-09-26 ${"─".repeat(46)}`,
            `── 2026-09-27 ${"─".repeat(46)}`,
        ]);
    });

    it("renders an unstamped line with a blank time column and no day rule", () => {
        expect(renderAll(["no stamp here"])).toEqual([
            "         │ no stamp here",
        ]);
    });

    it("renders an empty stamped line as a bare gutter", () => {
        expect(last([`${S}x`, S])).toBe("         │");
    });
});

describe("glyphs replace the source prefix", () => {
    it.each([
        ["loop-drain[run]: run 1-2", "▶ run 1-2"],
        ["loop-handoff[warn]: WARNING — x", "⚠ WARNING — x"],
        ["loop-drain[error]: pre-flight FAILED", "✗ pre-flight FAILED"],
        ["loop-drain: waiting 45s", "· waiting 45s"],
    ])("%s", (content, body) => {
        expect(last([`${S}${content}`])).toBe(`10:00:00 │ ${body}`);
    });

    it.each([
        ["warn", "33"],
        ["error", "31"],
    ])("colours a %s line with SGR %s", (tag, sgr) => {
        expect(last([`${S}loop-drain[${tag}]: x`], COLOR)).toContain(
            `\x1b[${sgr}m`
        );
    });
});

describe("pass header rule", () => {
    it("names pass · issue · tier and fills to the terminal width", () => {
        const line = last([
            `${S}loop-drain[pass]: pass 19 — issue #4516 on tier opus.`,
        ]);
        expect(line).toBe(
            `10:00:00 ├─ pass 19 · #4516 · opus ${"─".repeat(25)}`
        );
        expect(visibleLength(line)).toBe(60);
    });

    it("reads the header past a trailing session id, showing its first block (issue #4722)", () => {
        const line = last([
            `${S}loop-drain[pass]: pass 19 — issue #4516 on tier opus. session=0f8c2a4e-1b2c-4d3e-8f9a-0b1c2d3e4f5a`,
        ]);
        expect(line).toMatch(
            /^10:00:00 ├─ pass 19 · #4516 · opus 0f8c2a4e ─+$/
        );
        expect(visibleLength(line)).toBe(60);
    });

    it("keeps the message of a prompt-scoped pass", () => {
        expect(
            last([`${S}loop-drain[pass]: pass 2 — prompt "/next-ticket 3131".`])
        ).toMatch(/^10:00:00 ├─ pass 2 — prompt "\/next-ticket 3131" ─+$/);
    });
});

describe("pass footer rule", () => {
    const facts =
        "queue_before=12 queue_after=11 spent=70000000 budget=140000000 ceiling=140000000 duration=879";

    it.each([
        ["-", "0", "✓ done", "32"],
        ["claude-retry", "60", "✗ crashed · retry in 1m00s", "31"],
        ["claude-error", "0", "✗ crashed · stopping", "31"],
        [
            "claims-held-retry",
            "0",
            "✗ died holding claims · next pass reaps",
            "31",
        ],
        ["rate-limit", "0", "⏸ rate-limited · stopping", "33"],
        ["no-progress", "0", "⏸ no progress · stopping", "33"],
    ])("reason %s → %s", (reason, retry, outcome, sgr) => {
        const plain = last(
            [end(`reason=${reason} retry=${retry} ${facts}`)],
            WIDE
        );
        expect(plain).toMatch(
            new RegExp(
                `^10:00:00 ├─ ${outcome.replace(/[()]/g, "\\$&")} · 14m39s · queue 12→11 · █████░░░░░ 70M/140M 50% ─+$`
            )
        );
        expect(visibleLength(plain)).toBe(120);
        const colored = last(
            [end(`reason=${reason} retry=${retry} ${facts}`)],
            { ...WIDE, color: true }
        );
        expect(colored).toContain(`\x1b[${sgr}m${outcome}`);
    });

    it.each([
        [0.75, "green"],
        [0.76, "yellow"],
        [0.9, "yellow"],
        [0.91, "red"],
    ])("bar tone at %s of the ceiling is %s", (ratio, tone) => {
        expect(budgetTone(ratio)).toBe(tone);
    });

    it.each([
        [75_000_000, "32"],
        [80_000_000, "33"],
        [95_000_000, "31"],
    ])("draws the bar for spent=%s in SGR %s", (spent, sgr) => {
        const line = last(
            [end(`reason=- spent=${spent} ceiling=100000000 duration=1`)],
            COLOR
        );
        expect(line).toMatch(new RegExp(`\\x1b\\[${sgr}m█`));
    });

    it("says spend n/a when the run is unbudgeted", () => {
        expect(
            last([
                end(
                    "reason=- queue_before=3 queue_after=2 spent=- budget=- ceiling=- duration=5"
                ),
            ])
        ).toMatch(/· queue 3→2 · spend n\/a ─+$/);
    });
});

describe("run summary box", () => {
    const summary = (fields: string, env: RenderEnv = PLAIN) =>
        renderAll([`${S}loop-drain[summary]: ${fields}`], env).slice(1);

    it("is a 3–4 line box with aligned borders", () => {
        const box = summary(
            "passes=20 reason=budget queue_start=30 queue_end=11 final_pct=100.3 spent=140420000 budget=140000000 ceiling=140000000 duration=29508"
        );
        expect(box).toEqual([
            "10:00:00 │ ╭─ run summary ───────────────╮",
            "         │ │ passes 20 · stopped: budget │",
            "         │ │ queue 30 → 11               │",
            "         │ │ ██████████ 140.4M/140M 100% │",
            "         │ │ duration 8h11m              │",
            "         │ ╰─────────────────────────────╯",
        ]);
    });

    it("drops the duration row when the summary has none", () => {
        const box = summary(
            "passes=0 reason=stop-file queue_start=? queue_end=? final_pct=n/a spent=0 budget=n/a"
        );
        expect(box).toHaveLength(5);
        expect(box.join("\n")).not.toMatch(/duration/);
        expect(box.join("\n")).toMatch(/spend n\/a/);
    });

    it.each([
        ["queue-empty", "32"],
        ["budget", "33"],
        ["gh-error", "31"],
    ])("colours stop reason %s with SGR %s", (reason, sgr) => {
        expect(
            summary(`passes=1 reason=${reason}`, COLOR).join("\n")
        ).toContain(`\x1b[${sgr}m${reason}`);
    });
});

describe("sweep collapse — buffered until the block closes (issue #4718)", () => {
    const T1 = "2026-09-26 10:00:00 ";
    const T2 = "2026-09-26 10:05:00 ";
    const T3 = "2026-09-26 10:10:00 ";
    const CLOSER = `${T3}loop-drain[pass]: pass 1 — issue #1 on tier opus.`;

    /** A sweep block: the tag line plus its rows, all sharing ONE stamp —
     * the same shape `loop-doctor.ts`'s synchronous run actually produces. */
    const sweep = (time: string, rows: string[]) => [
        `${time}loop-drain[sweep]: orphan-claim sweep —`,
        ...rows.map((r) => `${time}${r}`),
    ];
    const healthyRow = (issue: number, age = "claimed 1.0h ago") =>
        `  · #${issue} some issue title                                       ${age}`;
    const recoverableRow = (issue: number, age = "claimed 6.2h ago") =>
        `  ! #${issue} some issue title                                       local branch, ${age}`;
    const orphanRow = (issue: number, age = "claimed 30.0h ago") =>
        `  × #${issue} some issue title                                       no branch, no PR — ${age}`;
    const countLine = (claimed: number, orphaned: number) =>
        `${claimed} claimed, ${orphaned} orphaned (nothing is going to release them).`;
    const recoverableHeader = (n: number) =>
        `${n} RECOVERABLE — a dead pass left a local branch behind. Not released; the next pass resumes it:`;
    /** The second, redundant listing `loop-doctor.ts` prints for every
     * recoverable issue, alongside its roster row. */
    const recoverableResumeLine = (issue: number, age = "claimed 6.2h ago") =>
        `  ! #${issue} (branch *issue-${issue}) — local branch, ${age}`;

    it("prints the run's first sweep in full", () => {
        const out = renderAll([
            ...sweep(T1, [healthyRow(100), countLine(1, 0)]),
            CLOSER,
        ]);
        expect(out.slice(1, 4)).toEqual([
            "10:00:00 │ ◌ orphan-claim sweep —",
            `         │ ${healthyRow(100)}`,
            `         │ ${countLine(1, 0)}`,
        ]);
    });

    it("collapses an identical sweep to one line, ignoring claim age", () => {
        const first = sweep(T1, [
            healthyRow(100, "claimed 1.0h ago"),
            countLine(1, 0),
        ]);
        const second = sweep(T2, [
            healthyRow(100, "claimed 6.2h ago"),
            countLine(1, 0),
        ]);
        const out = renderAll([...first, ...second, CLOSER]);
        expect(out.at(-2)).toBe(
            "10:05:00 │ ◌ sweep unchanged · 1 claimed · 0 orphaned · 0 recoverable"
        );
    });

    it("prints in full when the row set changes, even with the same counts", () => {
        // Same claimed/orphaned/recoverable counts both times — only the
        // issue number differs, isolating the row-set comparison from the
        // count one.
        const first = sweep(T1, [healthyRow(100), countLine(1, 0)]);
        const second = sweep(T2, [healthyRow(200), countLine(1, 0)]);
        const out = renderAll([...first, ...second, CLOSER]);
        const headers = out.filter((l) => l.includes("◌ orphan-claim sweep —"));
        expect(headers).toHaveLength(2);
        expect(out).toContain(`         │ ${healthyRow(200)}`);
        expect(out.join("\n")).not.toContain("sweep unchanged");
    });

    it("prints in full when only a count changes", () => {
        const first = sweep(T1, [healthyRow(100), countLine(1, 0)]);
        // Same roster row, different claimed count — the two fields are
        // parsed independently, so a mismatch here must not be masked by
        // the row set matching.
        const second = sweep(T2, [healthyRow(100), countLine(2, 0)]);
        const out = renderAll([...first, ...second, CLOSER]);
        expect(out.join("\n")).not.toContain("sweep unchanged");
        expect(
            out.filter((l) => l.includes("◌ orphan-claim sweep —"))
        ).toHaveLength(2);
    });

    it("never collapses a sweep with orphaned > 0, even repeated identically", () => {
        const rows = [orphanRow(300), countLine(1, 1)];
        const out = renderAll([...sweep(T1, rows), ...sweep(T2, rows), CLOSER]);
        expect(
            out.filter((l) => l.includes("◌ orphan-claim sweep —"))
        ).toHaveLength(2);
        expect(out.join("\n")).not.toContain("sweep unchanged");
    });

    it("colours recoverable rows yellow and informational rows dim", () => {
        const rows = [
            healthyRow(100),
            recoverableRow(200),
            countLine(2, 0),
            recoverableHeader(1),
            recoverableResumeLine(200),
        ];
        const out = renderAll([...sweep(T1, rows), CLOSER], COLOR);
        const joined = out.join("\n");
        expect(joined).toContain(`\x1b[2m${healthyRow(100)}\x1b[0m`);
        expect(joined).toContain(`\x1b[33m${recoverableRow(200)}\x1b[0m`);
    });

    it("names each recoverable issue once in the collapsed line, despite the doubled listing", () => {
        const rows = [
            healthyRow(100),
            recoverableRow(4352),
            countLine(2, 0),
            recoverableHeader(1),
            recoverableResumeLine(4352),
        ];
        const out = renderAll([...sweep(T1, rows), ...sweep(T2, rows), CLOSER]);
        expect(out.at(-2)).toBe(
            "10:05:00 │ ◌ sweep unchanged · 2 claimed · 0 orphaned · 1 recoverable (#4352)"
        );
    });

    it("flushPending closes a sweep block still open at the end of the stream", () => {
        let state = INITIAL_RENDER_STATE;
        for (const line of sweep(T1, [healthyRow(100), countLine(1, 0)])) {
            state = render(state, line, PLAIN).state;
        }
        const flushed = flushPending(state, PLAIN);
        expect(flushed.output).toEqual([
            `── 2026-09-26 ${"─".repeat(60 - 14)}`,
            "10:00:00 │ ◌ orphan-claim sweep —",
            `         │ ${healthyRow(100)}`,
            `         │ ${countLine(1, 0)}`,
        ]);
        expect(flushPending(flushed.state, PLAIN).output).toEqual([]);
    });
});

describe("renderSafely — a throw costs no line", () => {
    it("prints the raw line and one degraded notice, keeping the state", () => {
        const boom = (): never => {
            throw new Error("kaboom");
        };
        const state = { day: "2026-09-26", stamp: "2026-09-26 09:00:00" };
        const r = renderSafely(state, `${S}loop-drain[end]: x`, PLAIN, boom);
        expect(r.output).toEqual([`${S}loop-drain[end]: x`]);
        expect(r.notice).toBe("loop-render: degraded to plain — kaboom");
        expect(r.state).toBe(state);
    });

    it("carries no notice when the line renders", () => {
        expect(
            renderSafely(INITIAL_RENDER_STATE, `${S}x`, PLAIN).notice
        ).toBeUndefined();
    });
});

describe("pass-summary markdown in body lines (issue #4719)", () => {
    const NARROW: RenderEnv = { width: 30, color: false };
    const REPO: RenderEnv = {
        width: 60,
        color: true,
        repoUrl: "https://github.com/acme/widgets",
    };

    it("renders **bold** without the asterisks", () => {
        expect(last([`${S}**Test:** all green`], PLAIN)).toBe(
            "10:00:00 │ Test: all green"
        );
        expect(last([`${S}**Test:** all green`], COLOR)).toContain(
            "\x1b[1mTest:\x1b[0m all green"
        );
    });

    it("renders `code` in cyan without backticks", () => {
        expect(last([`${S}run \`bun test\` first`], PLAIN)).toBe(
            "10:00:00 │ run bun test first"
        );
        expect(last([`${S}run \`bun test\` first`], COLOR)).toContain(
            "\x1b[36mbun test\x1b[0m"
        );
    });

    it("a ** inside a code span never pairs with a later real **bold** on the same line (PR #4745 review)", () => {
        const out = last(
            [`${S}use \`x**2\` and also **real bold** here`],
            PLAIN
        );
        // Plain text stays fully readable either way; the real regression is
        // colour mode below, where the stray `**` used to steal the reset
        // and swallow "and also".
        expect(out).toBe("10:00:00 │ use x**2 and also real bold here");
        const colored = last(
            [`${S}use \`x**2\` and also **real bold** here`],
            COLOR
        );
        expect(colored).toContain("\x1b[36mx**2\x1b[0m");
        expect(colored).toContain("\x1b[1mreal bold\x1b[0m");
        expect(colored).toContain("and also");
    });

    it("turns - and 2-space -- into two bullet levels", () => {
        const out = renderAll([`${S}- top`, `${S}  - nested`], PLAIN);
        expect(out[1]).toBe("10:00:00 │ • top");
        expect(out[2]).toMatch(/^ {9}│ {3}◦ nested$/);
    });

    it("wraps a PR reference in an OSC 8 link to the resolved repo's pull path", () => {
        const out = last([`${S}see PR #4732 for it`], REPO);
        expect(out).toContain(
            "\x1b]8;;https://github.com/acme/widgets/pull/4732\x1b\\"
        );
        expect(out).toContain("PR #4732");
        expect(out).toContain("\x1b]8;;\x1b\\");
        expect(out).toContain("\x1b[36m");
    });

    it("wraps an issue reference in an OSC 8 link to the resolved repo's issues path", () => {
        const out = last([`${S}closes issue #4517`], REPO);
        expect(out).toContain(
            "\x1b]8;;https://github.com/acme/widgets/issues/4517\x1b\\"
        );
        expect(out).toContain("issue #4517");
    });

    it("links a bare #N reference too, to the issues path", () => {
        const out = last([`${S}see #4517`], REPO);
        expect(out).toContain(
            "\x1b]8;;https://github.com/acme/widgets/issues/4517\x1b\\"
        );
    });

    it("highlights a reference without a link when no repo URL resolved", () => {
        const out = last([`${S}see #4517`], COLOR);
        expect(out).not.toContain("\x1b]8;;");
        expect(out).toContain("\x1b[36m#4517\x1b[0m");
    });

    it("soft-wraps a long bullet with a hanging indent under the bullet, never a bare glyph on a continuation", () => {
        const words = Array.from({ length: 14 }, (_, i) => `word${i}`);
        const out = renderAll([`${S}- ${words.join(" ")}`], NARROW).slice(1);
        expect(out.length).toBeGreaterThan(1);
        expect(out[0]).toMatch(/^10:00:00 │ • word0\b/);
        for (const line of out)
            expect(visibleLength(line)).toBeLessThanOrEqual(NARROW.width);
        for (const cont of out.slice(1)) expect(cont).toMatch(/^ {9}│ {3}\S/);
        // every word survives, in order, none split across the wrap
        const allWords = out
            .map((l) => l.replace(/^.*?│ {1,3}(?:[•◦] )?/, ""))
            .join(" ")
            .split(/\s+/);
        expect(allWords).toEqual(words);
    });

    it("passes a fenced code block through untouched and unwrapped", () => {
        const out = renderAll(
            [
                `${S}\`\`\`ts`,
                `${S}const x = 1; // a comment far too long to fit inside width 30 unwrapped`,
                `${S}\`\`\``,
            ],
            NARROW
        );
        const codeLine = out.find((l) => l.includes("const x = 1"));
        expect(codeLine).toBeDefined();
        expect(visibleLength(codeLine as string)).toBeGreaterThan(NARROW.width);
    });

    it("passes a table row through untouched, pipes and all, even wider than the terminal", () => {
        expect(last([`${S}| a | b | c |`], PLAIN)).toBe(
            "10:00:00 │ | a | b | c |"
        );
        const wideRow =
            "| aaaaaaaaaa | bbbbbbbbbb | cccccccccc | dddddddddd | eeeeeeeeee |";
        const out = last([`${S}${wideRow}`], NARROW);
        expect(out).toBe(`10:00:00 │ ${wideRow}`);
        expect(visibleLength(out)).toBeGreaterThan(NARROW.width);
    });

    it("emits no escape sequences, OSC 8 included, with colour off", () => {
        const out = last(
            [`${S}**bold** \`code\` see PR #4732 and issue #4517`],
            {
                ...NARROW,
                width: 100,
                repoUrl: "https://github.com/acme/widgets",
            }
        );
        expect(out).not.toContain("\x1b");
        expect(out).toContain("bold");
        expect(out).toContain("code");
        expect(out).toContain("PR #4732");
        expect(out).toContain("issue #4517");
    });
});

describe("golden: a real loop-afk.log excerpt", () => {
    const excerpt = fs
        .readFileSync(path.join(FIXTURES, "afk-excerpt.log"), "utf8")
        .replace(/\n$/, "")
        .split("\n");
    const env = { width: 100 };

    it("colour off: layout only, zero ANSI", async () => {
        const out = renderAll(excerpt, { ...env, color: false }).join("\n");
        expect(out).not.toContain("\x1b");
        await expect(`${out}\n`).toMatchFileSnapshot(
            path.join(FIXTURES, "afk-excerpt.plain.txt")
        );
    });

    it("colour forced", async () => {
        // ESC is written as a visible `\e`: a raw control byte in a tracked
        // text file reds `source-control-bytes.test.ts`.
        const out = renderAll(excerpt, { ...env, color: true })
            .join("\n")
            .replaceAll("\x1b", "\\e");
        expect(out).toContain("\\e[");
        await expect(`${out}\n`).toMatchFileSnapshot(
            path.join(FIXTURES, "afk-excerpt.color.txt")
        );
    });
});

describe("the stdin→stdout wrapper", () => {
    it("passes bytes through untouched when stdout is not a terminal", () => {
        // `loop-handoff.sh` always pipes the stream through the wrapper; a pipe,
        // a file or a test harness must get the log's own lines back.
        const input = `${S}loop-drain[pass]: pass 1 — issue #1 on tier opus.\n${S}x\n`;
        const r = spawnSync(
            "bun",
            [path.join(__dirname, "..", "loop-render.ts")],
            { input, encoding: "utf8", timeout: 30_000 }
        );
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toBe(input);
    });
});

describe("parseRemoteUrl — the three remote-URL shapes git hands back (PR #4745 review)", () => {
    it.each([
        ["git@github.com:acme/widgets.git", "https://github.com/acme/widgets"],
        ["git@github.com:acme/widgets", "https://github.com/acme/widgets"],
        [
            "https://github.com/acme/widgets.git",
            "https://github.com/acme/widgets",
        ],
        ["https://github.com/acme/widgets", "https://github.com/acme/widgets"],
        [
            "ssh://git@github.com/acme/widgets.git",
            "https://github.com/acme/widgets",
        ],
        [
            "ssh://git@github.com/acme/widgets",
            "https://github.com/acme/widgets",
        ],
    ])("%s → %s", (raw, expected) => {
        expect(parseRemoteUrl(raw)).toBe(expected);
    });

    it("returns undefined for a shape it doesn't recognise", () => {
        expect(parseRemoteUrl("not a remote url")).toBeUndefined();
    });
});
