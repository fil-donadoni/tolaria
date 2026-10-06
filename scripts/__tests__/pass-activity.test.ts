import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    appendFileSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassActivityReader, projectSlugOf } from "../lib/pass-activity";

/**
 * Issue #4722 — the status line's level B comes off ONE pass's transcript,
 * bound by the `--session-id` the driver minted. Every test writes its own
 * transcripts into a temp `projects` root (prior art: `live-activity.test.ts`);
 * the reader takes root and slug as parameters so nothing here can read the
 * operator's real `~/.claude/projects`.
 */

const SLUG = "-Users-someone-code-proj";
const SESSION = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";

let root: string;
let dir: string;

/** An assistant line: sonnet weights 1 input + 5 output → 10 + 100 = 110. */
const assistant = (
    id: string,
    blocks: unknown[],
    stop: string | null = null
): string =>
    JSON.stringify({
        type: "assistant",
        timestamp: "2026-09-27T10:00:00.000Z",
        message: {
            id,
            model: "claude-sonnet-5",
            stop_reason: stop,
            usage: {
                input_tokens: 10,
                output_tokens: 20,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
            },
            content: blocks,
        },
    });
const user = (text: string): string =>
    JSON.stringify({
        type: "user",
        timestamp: "2026-09-27T10:00:00.000Z",
        message: { role: "user", content: text },
    });
const toolUse = (name: string, input: unknown) => ({
    type: "tool_use",
    id: `t-${name}`,
    name,
    input,
});

const mainPath = () => join(dir, `${SESSION}.jsonl`);
const subPath = (agent: string) =>
    join(dir, SESSION, "subagents", `agent-${agent}.jsonl`);
const writeLines = (path: string, lines: string[]) =>
    writeFileSync(path, lines.map((l) => `${l}\n`).join(""));
const reader = (session = SESSION) =>
    new PassActivityReader({
        projectsRoot: root,
        projectSlug: SLUG,
        session,
    });

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tolaria-pass-activity-"));
    dir = join(root, SLUG);
    mkdirSync(join(dir, SESSION, "subagents"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("PassActivityReader — one pass's transcript (issue #4722)", () => {
    it("names the LAST tool the main session called, with its target", () => {
        writeLines(mainPath(), [
            user("/next-ticket 4722"),
            assistant("m1", [toolUse("Read", { file_path: "/a/b.ts" })]),
            assistant("m2", [
                { type: "text", text: "now running" },
                toolUse("Bash", { command: "bunx vitest run x.test.ts" }),
            ]),
        ]);
        expect(reader().refresh()?.lastTool).toEqual({
            name: "Bash",
            target: "bunx vitest run x.test.ts",
        });
    });

    it("counts only subagents whose turn has not ended", () => {
        writeLines(mainPath(), [assistant("m1", [])]);
        // Ended: its last assistant line stopped on end_turn.
        writeLines(subPath("done"), [
            user("review"),
            assistant("s1", [toolUse("Read", { file_path: "x" })], "tool_use"),
            assistant("s2", [{ type: "text", text: "LGTM" }], "end_turn"),
        ]);
        // Running: mid tool call.
        writeLines(subPath("busy"), [
            user("investigate"),
            assistant("s3", [toolUse("Grep", { pattern: "x" })], "tool_use"),
        ]);
        // Just spawned: no assistant line yet.
        writeLines(subPath("fresh"), [user("research")]);
        expect(reader().refresh()?.activeSubagents).toBe(2);
    });

    it("a subagent resumed after end_turn is active again", () => {
        writeLines(mainPath(), [assistant("m1", [])]);
        writeLines(subPath("a"), [
            user("go"),
            assistant("s1", [{ type: "text", text: "done" }], "end_turn"),
        ]);
        const r = reader();
        expect(r.refresh()?.activeSubagents).toBe(0);
        appendFileSync(subPath("a"), `${user("one more thing")}\n`);
        expect(r.refresh()?.activeSubagents).toBe(1);
    });

    it("sums the pass's weighted tokens over main AND subagents, incrementally", () => {
        writeLines(mainPath(), [assistant("m1", [])]);
        writeLines(subPath("a"), [assistant("s1", [], "end_turn")]);
        const r = reader();
        expect(r.refresh()?.tokens).toBe(220);
        // Only the appended bytes are read: a second refresh with nothing new
        // adds nothing, a new line adds exactly its own weight.
        expect(r.refresh()?.tokens).toBe(220);
        appendFileSync(mainPath(), `${assistant("m2", [])}\n`);
        expect(r.refresh()?.tokens).toBe(330);
    });

    it("rebuilds the pass from byte 0 when a transcript shrinks under it", () => {
        writeLines(mainPath(), [
            assistant("m1", [toolUse("Read", { file_path: "/old" })]),
            assistant("m2", []),
        ]);
        const r = reader();
        expect(r.refresh()?.tokens).toBe(220);
        writeLines(mainPath(), [assistant("m3", [])]);
        expect(r.refresh()).toEqual({
            lastTool: null,
            activeSubagents: 0,
            tokens: 110,
        });
    });

    it("stops counting a subagent whose transcript is gone", () => {
        writeLines(mainPath(), [assistant("m1", [])]);
        writeLines(subPath("a"), [user("go")]);
        const r = reader();
        expect(r.refresh()?.activeSubagents).toBe(1);
        rmSync(subPath("a"));
        expect(r.refresh()?.activeSubagents).toBe(0);
    });

    it("re-reads a half-written last line whole on the next refresh", () => {
        const line = assistant("m1", [toolUse("Edit", { file_path: "/z" })]);
        writeFileSync(mainPath(), line.slice(0, 40));
        const r = reader();
        expect(r.refresh()).toEqual({
            lastTool: null,
            activeSubagents: 0,
            tokens: 0,
        });
        appendFileSync(mainPath(), `${line.slice(40)}\n`);
        expect(r.refresh()).toMatchObject({
            lastTool: { name: "Edit", target: "/z" },
            tokens: 110,
        });
    });

    it("reads nothing but its own session's transcript", () => {
        writeLines(mainPath(), [assistant("m1", [])]);
        writeLines(join(dir, `${OTHER}.jsonl`), [
            assistant("o1", [
                toolUse("Bash", { command: "echo other-session" }),
            ]),
        ]);
        expect(reader().refresh()).toEqual({
            lastTool: null,
            activeSubagents: 0,
            tokens: 110,
        });
    });

    it("finds the transcript under a worktree's project dir of the same slug", () => {
        const wt = join(root, `${SLUG}-issue-4722`);
        mkdirSync(wt, { recursive: true });
        rmSync(dir, { recursive: true, force: true });
        writeLines(join(wt, `${SESSION}.jsonl`), [assistant("m1", [])]);
        expect(reader().refresh()?.tokens).toBe(110);
    });

    it("returns null — the level-A fallback — when the transcript is not on disk", () => {
        expect(reader().refresh()).toBeNull();
        expect(reader(OTHER).refresh()).toBeNull();
    });

    it("never touches the filesystem for a session id that is not a UUID", () => {
        writeLines(join(dir, "..%2Fx.jsonl"), [assistant("m1", [])]);
        expect(reader("../x").refresh()).toBeNull();
        expect(reader("..%2Fx").refresh()).toBeNull();
    });
});

describe("projectSlugOf", () => {
    it("maps a cwd to Claude Code's project directory name", () => {
        expect(projectSlugOf("/Users/someone/code/proj")).toBe(SLUG);
        expect(projectSlugOf("/Users/a.b/c_d")).toBe("-Users-a-b-c-d");
    });
});
