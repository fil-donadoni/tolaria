import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    appendFileSync,
    rmSync,
    utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    LiveIndex,
    issueMentions,
    projectDirsOf,
    parseTailEntries,
    readTail,
    describeToolInput,
    hourStartOf,
    TAIL_INITIAL_ENTRIES,
    ACTIVITY_WINDOW_HOURS,
} from "../lib/live-activity";

/**
 * Issue #3135 — the Now view's live data comes off the session transcripts,
 * through an incremental index. Every test here writes its OWN transcripts
 * into a temp `projects` root: the index takes the root and the slug as
 * parameters precisely so a test can never read the operator's real
 * `~/.claude/projects`.
 */

const SLUG = "-Users-someone-code-proj";
const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const SESSION_C = "33333333-3333-4333-8333-333333333333";

let root: string;
const NOW = Date.parse("2026-09-07T15:30:00.000Z");
const HOUR = 3_600_000;

const iso = (ms: number) => new Date(ms).toISOString();

/** One assistant line with a usage payload, the shape the harness writes. */
const assistantLine = (
    id: string,
    ts: number,
    outTok: number,
    blocks: unknown[] = [{ type: "text", text: `reply ${id}` }],
    issue = 3096
) =>
    JSON.stringify({
        type: "assistant",
        uuid: `u-${id}-${blocks.length}`,
        timestamp: iso(ts),
        // The branch and cwd name the issue — a real transcript's every line
        // does, which is why `issue-N` is one of the three spellings counted.
        cwd: `/Users/someone/code/proj-issue-${issue}`,
        gitBranch: `feat/issue-${issue}`,
        message: {
            id,
            role: "assistant",
            model: "claude-sonnet-5",
            usage: {
                input_tokens: 10,
                output_tokens: outTok,
                cache_read_input_tokens: 1000,
                cache_creation_input_tokens: 0,
            },
            content: blocks,
        },
    });

const userLine = (
    ts: number,
    text: string,
    extra: Record<string, unknown> = {}
) =>
    JSON.stringify({
        type: "user",
        uuid: `user-${ts}`,
        timestamp: iso(ts),
        message: { role: "user", content: text },
        ...extra,
    });

function writeTranscript(dir: string, session: string, lines: string[]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${session}.jsonl`), lines.join("\n") + "\n");
}

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "live-activity-"));
    const main = join(root, SLUG);
    const wt = join(root, `${SLUG}-issue-3096`);
    // An unrelated project that shares a prefix but is NOT ours.
    mkdirSync(join(root, `${SLUG}x-other`), { recursive: true });
    writeTranscript(join(root, `${SLUG}x-other`), SESSION_C, [
        assistantLine("other", NOW - 5 * 60_000, 999),
    ]);

    // Session A, in the primary checkout: two lines share one response id
    // (a text block and a tool_use block of the SAME reply) — must bill once.
    writeTranscript(main, SESSION_A, [
        JSON.stringify({
            type: "custom-title",
            customTitle: "Emrakul",
            sessionId: SESSION_A,
        }),
        JSON.stringify({
            type: "last-prompt",
            lastPrompt: "/next-issue 3096",
            sessionId: SESSION_A,
        }),
        userLine(NOW - 2 * HOUR, "work on issue #3096 please"),
        assistantLine("r1", NOW - 2 * HOUR + 1000, 100),
        assistantLine("r1", NOW - 2 * HOUR + 1000, 100, [
            {
                type: "tool_use",
                name: "Bash",
                input: { command: "gh issue view 3096" },
            },
        ]),
        assistantLine("r2", NOW - 30 * 60_000, 50),
    ]);
    // Session B, in the worktree's own project dir, mentions a different
    // issue and is older.
    writeTranscript(wt, SESSION_B, [
        userLine(NOW - 5 * HOUR, "look at issue-4000 and #4000"),
        assistantLine("r3", NOW - 5 * HOUR + 500, 7, undefined, 4000),
    ]);
    // A subagent under session A, written recently.
    const subs = join(main, SESSION_A, "subagents");
    mkdirSync(subs, { recursive: true });
    writeFileSync(
        join(subs, "agent-abc.jsonl"),
        assistantLine("sub1", NOW - 10 * 60_000, 20) + "\n"
    );
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("live-activity — issue mentions (the issue → session heuristic)", () => {
    it("counts #N, issue-N and issue N spellings, and nothing else", () => {
        const m = issueMentions(
            "closes #3096; worktree tolaria-issue-3096; issue 3096 and Issue #3096; pid 48213 is not one; #12 too short"
        );
        expect(m.get(3096)).toBe(4);
        expect(m.has(48213)).toBe(false);
        expect(m.has(12)).toBe(false);
    });
});

describe("live-activity — project directories", () => {
    it("owns the slug's own dir and its worktrees, never a sibling that merely shares a prefix", () => {
        const dirs = projectDirsOf(root, SLUG).map((d) =>
            d.slice(root.length + 1)
        );
        expect(dirs.sort()).toEqual([SLUG, `${SLUG}-issue-3096`].sort());
    });
    it("a missing root is an empty list, not a throw", () => {
        expect(projectDirsOf(join(root, "nope"), SLUG)).toEqual([]);
    });
});

describe("live-activity — LiveIndex", () => {
    // Built inside the hook, not at describe time: `root` only exists once
    // `beforeAll` has minted the temp directory.
    let index: LiveIndex;
    beforeAll(() => {
        index = new LiveIndex({ projectsRoot: root, projectSlug: SLUG });
    });

    it("bills a response once even when its content blocks span two transcript lines (issue #3078's dedupe)", () => {
        index.refresh(NOW);
        const buckets = index.activity(NOW);
        expect(buckets).toHaveLength(ACTIVITY_WINDOW_HOURS);
        const twoHoursAgo = buckets.find(
            (b) => b.hourStart === hourStartOf(NOW - 2 * HOUR)
        )!;
        expect(twoHoursAgo.outTok).toBe(100);
        expect(twoHoursAgo.messages).toBe(1);
    });

    it("every hour of the window is present, oldest first, a quiet hour as a zero bar", () => {
        const buckets = index.activity(NOW);
        expect(buckets[buckets.length - 1].hourStart).toBe(hourStartOf(NOW));
        expect(buckets[0].hourStart).toBe(
            hourStartOf(NOW) - (ACTIVITY_WINDOW_HOURS - 1) * HOUR
        );
        const quiet = buckets.filter((b) => b.messages === 0);
        expect(quiet.length).toBeGreaterThan(0);
        expect(quiet[0].outTok).toBe(0);
    });

    it("summarises a session: title, last prompt, branch, in-window tokens, subagent count, mentions", () => {
        const a = index.session(SESSION_A)!;
        expect(a.title).toBe("Emrakul");
        expect(a.lastPrompt).toBe("/next-issue 3096");
        expect(a.gitBranch).toBe("feat/issue-3096");
        // r1 (100) + r2 (50) from the main transcript + sub1 (20).
        expect(a.outTok).toBe(170);
        expect(a.subagents).toBe(1);
        expect(a.mentions[3096]).toBeGreaterThanOrEqual(3);
    });

    it("never reads a sibling project that merely shares the slug's prefix", () => {
        expect(index.session(SESSION_C)).toBeNull();
    });

    it("maps an issue to the session that names it most; a session that never names it is not a candidate", () => {
        expect(index.sessionsForIssue(3096).map((s) => s.session)).toEqual([
            SESSION_A,
        ]);
        expect(index.sessionsForIssue(4000).map((s) => s.session)).toEqual([
            SESSION_B,
        ]);
        expect(index.sessionsForIssue(5555)).toEqual([]);
    });

    it("a session being written to NOW outranks an idle one that named the issue more — liveness before mention count", () => {
        const dir = join(root, "rank-case");
        const talker = "44444444-4444-4444-8444-444444444444";
        const worker = "55555555-5555-4555-8555-555555555555";
        // The talker names #7000 five times but went quiet an hour ago; the
        // worker names it once and is mid-turn.
        writeTranscript(dir, talker, [
            userLine(NOW - HOUR, "#7000 #7000 #7000 #7000 #7000"),
        ]);
        const hourAgo = (Date.now() - HOUR) / 1000;
        utimesSync(join(dir, `${talker}.jsonl`), hourAgo, hourAgo);
        writeTranscript(dir, worker, [userLine(NOW, "/next-issue 7000")]);
        const idx = new LiveIndex({
            projectsRoot: root,
            projectSlug: "rank-case",
        });
        idx.refresh(Date.now());
        expect(
            idx.sessionsForIssue(7000, Date.now()).map((s) => s.session)
        ).toEqual([worker, talker]);
    });

    it("live sessions are the ones written to within the live window", () => {
        // Filesystem mtimes are 'now' for every file the fixture wrote, so
        // liveness is judged against the real clock here.
        const live = index.liveSessions(Date.now()).map((s) => s.session);
        expect(live).toContain(SESSION_A);
        expect(live).toContain(SESSION_B);
        expect(index.liveSessions(Date.now() + 2 * HOUR)).toEqual([]);
    });

    it("a second refresh reads only the appended bytes — an appended line counts once, an unchanged file re-counts nothing", () => {
        appendFileSync(
            join(root, SLUG, `${SESSION_A}.jsonl`),
            assistantLine("r4", NOW - 60_000, 30) + "\n"
        );
        index.refresh(NOW + 1000);
        index.refresh(NOW + 2000);
        expect(index.session(SESSION_A)!.outTok).toBe(200);
        const thisHour = index
            .activity(NOW)
            .find((b) => b.hourStart === hourStartOf(NOW))!;
        expect(thisHour.outTok).toBe(100); // r2 (50) + sub1 (20) + r4 (30)
    });

    it("resolves a session id to its transcript only inside the slug's own dirs, and refuses a non-UUID", () => {
        expect(index.transcriptPath(SESSION_A)).toBe(
            join(root, SLUG, `${SESSION_A}.jsonl`)
        );
        expect(index.transcriptPath(SESSION_B)).toBe(
            join(root, `${SLUG}-issue-3096`, `${SESSION_B}.jsonl`)
        );
        expect(index.transcriptPath(SESSION_C)).toBeNull();
        expect(index.transcriptPath("../../etc/passwd")).toBeNull();
        expect(index.transcriptPath(`${SESSION_A}/../x`)).toBeNull();
    });
});

describe("live-activity — tail entries", () => {
    it("renders the conversation: prompt, reply, thinking (clipped), tool call summary, tool result, system — and drops meta/snapshot lines", () => {
        const lines = [
            userLine(NOW, "<local-command-caveat>…", { isMeta: true }),
            JSON.stringify({ type: "file-history-snapshot", snapshot: {} }),
            userLine(NOW, "fix the bug"),
            assistantLine("x", NOW, 1, [
                { type: "thinking", thinking: "t".repeat(500) },
                { type: "text", text: "On it." },
                {
                    type: "tool_use",
                    name: "Bash",
                    input: { command: "bun test" },
                },
            ]),
            JSON.stringify({
                type: "user",
                timestamp: iso(NOW),
                message: {
                    role: "user",
                    content: [
                        {
                            type: "tool_result",
                            tool_use_id: "t",
                            content: "42 passed",
                            is_error: false,
                        },
                    ],
                },
            }),
            JSON.stringify({
                type: "system",
                level: "info",
                content: "Context compacted",
                timestamp: iso(NOW),
            }),
        ];
        const entries = parseTailEntries(lines);
        expect(entries.map((e) => e.kind)).toEqual([
            "user",
            "thinking",
            "assistant",
            "tool_use",
            "tool_result",
            "system",
        ]);
        expect(entries[1].text.length).toBeLessThanOrEqual(301);
        expect(entries[3].tool).toBe("Bash");
        expect(entries[3].text).toBe("bun test");
        expect(entries[4].isError).toBe(false);
        expect(entries[4].text).toBe("42 passed");
    });

    it("summarises a tool call the way the terminal does", () => {
        expect(describeToolInput("Read", { file_path: "/a/b.ts" })).toBe(
            "/a/b.ts"
        );
        expect(
            describeToolInput("Agent", {
                description: "review PR #1",
                prompt: "…",
            })
        ).toBe("review PR #1");
        expect(describeToolInput("Grep", { pattern: "foo", path: "src" })).toBe(
            "foo in src"
        );
        expect(describeToolInput("Whatever", { a: 1, b: 2 })).toBe("a, b");
        expect(describeToolInput("Bash", null)).toBe("");
    });

    it("readTail: the first read returns the file's tail and an offset; a second read with that offset returns only what was appended", () => {
        const dir = join(root, "tail-case");
        const many = Array.from({ length: TAIL_INITIAL_ENTRIES + 40 }, (_, i) =>
            userLine(NOW + i, `prompt ${i}`)
        );
        writeTranscript(dir, SESSION_C, many);
        const path = join(dir, `${SESSION_C}.jsonl`);

        const first = readTail(path, SESSION_C, null);
        expect(first.entries).toHaveLength(TAIL_INITIAL_ENTRIES);
        expect(first.entries[first.entries.length - 1].text).toBe(
            `prompt ${TAIL_INITIAL_ENTRIES + 39}`
        );
        expect(first.truncated).toBe(true);

        const nothing = readTail(path, SESSION_C, first.offset);
        expect(nothing.entries).toEqual([]);
        expect(nothing.offset).toBe(first.offset);

        // A half-written line stays unread until its newline lands.
        appendFileSync(path, userLine(NOW + 9999, "late").slice(0, 20));
        expect(readTail(path, SESSION_C, first.offset).entries).toEqual([]);
        appendFileSync(path, userLine(NOW + 9999, "late").slice(20) + "\n");
        const next = readTail(path, SESSION_C, first.offset);
        expect(next.entries.map((e) => e.text)).toEqual(["late"]);
        expect(next.offset).toBeGreaterThan(first.offset);
    });
});
