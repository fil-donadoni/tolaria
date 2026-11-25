/**
 * The replay journal (issue #10737): a sweep cut by its wall resumes under the
 * same Bot and definition, and only there.
 */
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BotReachVerdict } from "../../convex/gre/ai/botReach";
import type { CompiledDefinition } from "../../convex/oracle/types";
import {
    botReplayJournalPath,
    openReplayJournal,
    readReplayAttempt,
    writeReplayAttempt,
} from "../lib/bot-replay-journal";
import { playJournaled } from "../oracle-compile";

const PLAYED: BotReachVerdict = { outcome: "played" };
const IGNORED: BotReachVerdict = {
    outcome: "ignored",
    cause: "never-chosen",
    form: "sorcery",
};
const HARNESS: BotReachVerdict = {
    outcome: "ignored",
    cause: "harness-error",
    form: "sweep worker: no answer",
};
const def = (name: string) => ({ name }) as unknown as CompiledDefinition;
const DEFS = new Map([
    ["a", def("A")],
    ["b", def("B")],
    ["c", def("C")],
]);

let dir: string;
let path: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bot-replay-"));
    path = botReplayJournalPath(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fill = (botHash = "bot1") => {
    const journal = openReplayJournal(path, botHash, DEFS);
    journal.record("a", PLAYED);
    journal.record("b", IGNORED);
};
const known = (botHash: string, defs = DEFS) =>
    openReplayJournal(path, botHash, defs).known;

describe("the replay journal", () => {
    it("a cut sweep resumes: only the missing card is played, the verdicts are the whole sweep's", async () => {
        fill();
        const asked: string[] = [];
        const verdicts = await playJournaled(
            path,
            "bot1",
            DEFS,
            async (missing, onVerdict) => {
                asked.push(...missing.keys());
                onVerdict("c", PLAYED);
                return new Map([["c", PLAYED]]);
            }
        );
        expect(asked).toEqual(["c"]);
        expect(Object.fromEntries(verdicts)).toEqual({
            a: PLAYED,
            b: IGNORED,
            c: PLAYED,
        });
        expect([...known("bot1").keys()]).toEqual(["a", "b", "c"]);
    });

    it("another Bot's verdicts are not used, and leave the file", () => {
        fill();
        expect(known("bot2").size).toBe(0);
        expect(known("bot1").size).toBe(0);
    });

    it("a card whose definition moved is played again", () => {
        fill();
        const moved = new Map(DEFS).set("a", def("A2"));
        expect([...known("bot1", moved).keys()]).toEqual(["b"]);
    });

    it("a torn last line is skipped, and what follows it is still read", () => {
        fill();
        appendFileSync(path, '{"botHash":"bot1","oracleId":"c","verd');
        openReplayJournal(path, "bot1", DEFS).record("c", PLAYED);
        expect(known("bot1").size).toBe(3);
    });

    it("a harness-error is never journaled", () => {
        openReplayJournal(path, "bot1", DEFS).record("a", HARNESS);
        expect(known("bot1").size).toBe(0);
    });
});

describe("the attempt", () => {
    it("is resumable only under its own Bot, with verdicts journaled", () => {
        expect(readReplayAttempt("bot1", dir)).toBeNull();
        writeReplayAttempt({ botHash: "bot1", startedAtMs: 5 }, dir);
        expect(readReplayAttempt("bot1", dir)).toEqual({
            startedAtMs: 5,
            resumable: false,
        });
        fill();
        expect(readReplayAttempt("bot1", dir)?.resumable).toBe(true);
        expect(readReplayAttempt("bot2", dir)).toEqual({
            startedAtMs: 5,
            resumable: false,
        });
    });
});
