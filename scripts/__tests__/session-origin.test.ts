import { describe, it, expect, afterAll } from "vitest";
import {
    mkdtempSync,
    writeFileSync,
    rmSync,
    utimesSync,
    statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    parseOriginLedger,
    resolveOrigin,
    OriginLedger,
    originLedgerPath,
    ENTRYPOINT_ORIGIN,
} from "../lib/session-origin";

/**
 * Issue #3144 — who started a session. Two signals with a precedence, and
 * every test below is about the SEAM between them: a recording beats an
 * inference, an inference beats nothing, and nothing must never render as
 * "a person did it".
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const roots: string[] = [];
function tempLedger(text: string): string {
    const dir = mkdtempSync(join(tmpdir(), "session-origin-"));
    roots.push(dir);
    const path = join(dir, "sessions.jsonl");
    writeFileSync(path, text);
    return path;
}

afterAll(() => {
    for (const d of roots) rmSync(d, { recursive: true, force: true });
});

describe("session-origin — the journal", () => {
    it("folds rows to session → origin, last row winning", () => {
        // The same session appears twice: `claude --resume` re-runs
        // SessionStart under the same id, and the LATEST start is the one
        // that describes how it is running now.
        const rows = parseOriginLedger(
            [
                JSON.stringify({ ts: 1, session: A, origin: "interactive" }),
                JSON.stringify({ ts: 2, session: B, origin: "afk" }),
                JSON.stringify({ ts: 3, session: A, origin: "afk" }),
            ].join("\n")
        );
        expect(rows.get(A)).toBe("afk");
        expect(rows.get(B)).toBe("afk");
        expect(rows.size).toBe(2);
    });

    it("skips a malformed or half-written line without losing the rows before it", () => {
        // The writer is a shell hook that can be killed mid-append, so the
        // LAST line is the one most likely to be broken — and it must not
        // cost the dashboard every row already read.
        const rows = parseOriginLedger(
            [
                JSON.stringify({ ts: 1, session: A, origin: "afk" }),
                "",
                "not json at all",
                '{"ts":2,"session":"' + B + '","origin":"inter',
            ].join("\n")
        );
        expect(rows.get(A)).toBe("afk");
        expect(rows.has(B)).toBe(false);
    });

    it("ignores a row whose origin is not one this reader understands", () => {
        // A future writer's vocabulary must read as "unrecorded" — i.e. fall
        // back to the entrypoint — never be coerced into one of the two
        // buckets it happens to sort next to.
        const rows = parseOriginLedger(
            [
                JSON.stringify({ ts: 1, session: A, origin: "cron" }),
                JSON.stringify({ ts: 2, session: B }),
                JSON.stringify({ ts: 3, origin: "afk" }),
            ].join("\n")
        );
        expect(rows.size).toBe(0);
    });
});

describe("session-origin — precedence", () => {
    it("a recorded origin beats the transcript's entrypoint, in both directions", () => {
        // Both directions on purpose: a recorded `interactive` must survive
        // an `sdk-cli` transcript (a person running `claude -p` by hand) and
        // a recorded `afk` must survive a `cli` one. If the ledger only won
        // when it agreed with the guess, it would not be winning at all.
        expect(resolveOrigin("interactive", "sdk-cli")).toEqual({
            origin: "interactive",
            source: "ledger",
        });
        expect(resolveOrigin("afk", "cli")).toEqual({
            origin: "afk",
            source: "ledger",
        });
    });

    it("falls back to the entrypoint when nothing was recorded", () => {
        expect(resolveOrigin(undefined, "sdk-cli")).toEqual({
            origin: "afk",
            source: "entrypoint",
        });
        expect(resolveOrigin(undefined, "cli")).toEqual({
            origin: "interactive",
            source: "entrypoint",
        });
    });

    it("reads unknown — never interactive — with neither signal, and for an entrypoint it does not know", () => {
        // The whole safety property of this module: "we could not tell" must
        // not render as "a person is at the keyboard". A future harness
        // entrypoint is exactly the case that would otherwise be filed under
        // whichever bucket the fallback happened to be.
        for (const ep of [null, undefined, "", "sdk-ts", "vscode"]) {
            expect(resolveOrigin(undefined, ep).origin).toBe("unknown");
        }
        expect(resolveOrigin(undefined, null).source).toBe("none");
        expect(ENTRYPOINT_ORIGIN["sdk-ts"]).toBeUndefined();
    });
});

describe("session-origin — OriginLedger", () => {
    it("reads the journal, and re-reads it only once it has moved", () => {
        const path = tempLedger(
            JSON.stringify({ ts: 1, session: A, origin: "afk" }) + "\n"
        );
        // Both writes are stamped with the SAME fixed mtime, rather than the
        // second copying the first's: `utimesSync` takes seconds where
        // `statSync` reports milliseconds, so round-tripping the observed
        // stamp lands a fraction off and the cache correctly sees a moved
        // file — which would make this test pass for the wrong reason.
        const FIXED = new Date(1_700_000_000_000);
        utimesSync(path, FIXED, FIXED);
        const ledger = new OriginLedger(path);
        ledger.refresh();
        expect(ledger.recorded(A)).toBe("afk");
        expect(ledger.count).toBe(1);

        // Rewritten to name a DIFFERENT session at exactly the same byte
        // length and the same mtime — the two things the cache keys off — so
        // this content must NOT be picked up. Swapping the session rather
        // than the origin is what makes the assertion bite: a re-read would
        // show B and lose A, which "the answer did not change" alone could
        // not distinguish from a re-read that happened to agree.
        writeFileSync(
            path,
            JSON.stringify({ ts: 1, session: B, origin: "afk" }) + "\n"
        );
        utimesSync(path, FIXED, FIXED);
        expect(statSync(path).mtimeMs).toBe(FIXED.getTime());
        ledger.refresh();
        expect(ledger.recorded(A)).toBe("afk");
        expect(ledger.recorded(B)).toBeUndefined();

        // A real append moves the size, so it IS read.
        writeFileSync(
            path,
            [
                JSON.stringify({ ts: 1, session: A, origin: "afk" }),
                JSON.stringify({ ts: 2, session: B, origin: "interactive" }),
            ].join("\n") + "\n"
        );
        ledger.refresh();
        expect(ledger.recorded(B)).toBe("interactive");
        expect(ledger.count).toBe(2);
    });

    it("a missing journal is an EMPTY ledger, not an error", () => {
        // Every session then falls back to its entrypoint — the pre-#3144
        // reading. A throw here would take out `/api/live` entirely on a
        // machine that has simply never run the hook.
        const ledger = new OriginLedger(
            join(tmpdir(), "no-such-dir-3144", "sessions.jsonl")
        );
        expect(() => ledger.refresh()).not.toThrow();
        expect(ledger.count).toBe(0);
        expect(ledger.recorded(A)).toBeUndefined();
    });

    it("the default path is the project's own telemetry directory", () => {
        expect(originLedgerPath("/tmp/proj")).toBe(
            "/tmp/proj/.claude/telemetry/sessions.jsonl"
        );
    });
});
