import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * No tracked text source may contain a byte that makes it read as BINARY.
 *
 * WHY THIS IS A TEST AND NOT A NORM (issue #2221). `convex/gre/autoTap.ts`
 * carried a literal 0x00 inside a string literal — `join("<NUL>")` written as a
 * raw control character instead of the `\u0000` escape. The runtime string was
 * correct, nothing failed, and no reviewer could see it. But `file(1)`
 * classified the 1219-line auto-tap solver as `data`, and `grep`/`ripgrep`
 * skip binary files SILENTLY: no match, no warning. The module was invisible
 * to every text search in the repo.
 *
 * It cost real work. The `/audit-tracker` pass on issue #1733 and a delegated
 * subagent census both concluded `getManaTapOptionRestriction` was dead code
 * with zero callers — `convex/gre/autoTap.ts:4` imports it and uses it. That
 * conclusion reached an issue body before someone read the file directly.
 *
 * A wrong "not found" is more expensive than a missing file, because nothing
 * signals it: the search exits 0 and prints a shorter list. Any agent mapping a
 * subsystem, any grep-based guard and any human running `rg` is affected the
 * same way. That is not something a paragraph in a rules file can prevent —
 * the defect is invisible in the diff that introduces it.
 *
 * DENY-LIST, NOT ALLOW-LIST. The first draft enumerated the text extensions to
 * scan and thereby did not cover `.mts` (one tracked script), `.svg`, `.awk`,
 * `.jsonl`, `bun.lock` or the extensionless `.husky/` hooks — a hand-maintained
 * list that silently stops covering each new file type, which is the shape of
 * omission this guard exists to catch. Binary extensions are named instead, so
 * anything new is scanned by default and a false positive is loud.
 */

const ROOT = path.resolve(__dirname, "../..");

/** The file whose raw NUL motivated this guard — pinned so the scan is proven
 *  to reach the engine tree, and so this test carries a `convex/` literal in
 *  CODE: `scripts/test-env-split.ts` classifies it into the node-engine
 *  project by that literal, and a test that only mentioned the path in prose
 *  would silently demote itself to node-tooling on a reword. */
const ORIGIN_FILE = "convex/gre/autoTap.ts";

/** Extensions whose bytes are payload. Everything else tracked is scanned.
 *  Keep this list about FORMATS, never about individual files. */
const BINARY_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".avif",
    ".ico",
    ".pdf",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".gz",
    ".zip",
    ".mp3",
    ".mp4",
    ".wasm",
]);

/** C0 controls are forbidden except the three that legitimately occur in text:
 *  tab (0x09), newline (0x0a) and carriage return (0x0d). 0x00 is the one that
 *  actually flips `file(1)` and the grep family to "binary"; the rest of the
 *  range is refused with it because none of them belongs in a source file
 *  either, and a narrower rule would have to be widened the first time someone
 *  pastes a 0x0c or a 0x1b. */
const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]);

export interface ControlByteHit {
    byte: number;
    offset: number;
    line: number;
}

/** First forbidden control byte in `buf`, or null. Returns at the first hit, so
 *  the line-counting rescan runs at most once per file. Exported so the
 *  detector itself is testable — a scan that can never report anything would
 *  keep this guard green forever. */
export function findControlByte(buf: Buffer): ControlByteHit | null {
    for (let i = 0; i < buf.length; i++) {
        const byte = buf[i];
        if (byte >= 0x20 || ALLOWED_CONTROL_BYTES.has(byte)) continue;
        let line = 1;
        for (let j = 0; j < i; j++) if (buf[j] === 0x0a) line++;
        return { byte, offset: i, line };
    }
    return null;
}

interface Tracked {
    /** Repo-relative path, decoded. */
    rel: string;
    /** …and its raw bytes, kept so a lossy decode can be REPORTED rather than
     *  turning into a file that quietly does not exist and is skipped. */
    raw: Buffer;
}

function trackedFiles(): Tracked[] {
    const out = execFileSync("git", ["ls-files", "-z"], {
        cwd: ROOT,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
    });
    const entries: Tracked[] = [];
    let start = 0;
    for (let i = 0; i <= out.length; i++) {
        if (i !== out.length && out[i] !== 0x00) continue;
        if (i > start) {
            const raw = out.subarray(start, i);
            entries.push({ rel: raw.toString("utf8"), raw });
        }
        start = i + 1;
    }
    return entries;
}

describe("tracked text sources contain no binary-making control bytes", () => {
    it("the detector reports a NUL (the scan is not vacuous)", () => {
        expect(findControlByte(Buffer.from('join("\u0000")', "utf8"))).toEqual({
            byte: 0x00,
            offset: 6,
            line: 1,
        });
        expect(findControlByte(Buffer.from("line\ttab\r\nfine\n"))).toBeNull();
    });

    it("no tracked text file carries one", () => {
        const tracked = trackedFiles();
        // A selection that silently matched nothing would make this green.
        expect(tracked.length).toBeGreaterThan(1000);

        const offenders: string[] = [];
        const unreadable: string[] = [];
        let scanned = 0;

        for (const { rel, raw } of tracked) {
            if (BINARY_EXTENSIONS.has(path.extname(rel).toLowerCase()))
                continue;
            if (!Buffer.from(rel, "utf8").equals(raw)) {
                // A path git reported in bytes that do not round-trip through
                // UTF-8 would otherwise resolve to a file that "does not
                // exist" and be skipped without a word.
                unreadable.push(`${JSON.stringify(rel)} (path is not UTF-8)`);
                continue;
            }
            const abs = path.join(ROOT, rel);
            let stat: fs.Stats;
            try {
                stat = fs.lstatSync(abs);
            } catch {
                unreadable.push(`${rel} (tracked but not on disk)`);
                continue;
            }
            // git tracks symlinks as links; the target is either tracked in
            // its own right or outside the repo.
            if (!stat.isFile()) continue;
            scanned++;
            const hit = findControlByte(fs.readFileSync(abs));
            if (hit)
                offenders.push(
                    `${rel}:${hit.line} — byte 0x${hit.byte
                        .toString(16)
                        .padStart(2, "0")} at offset ${hit.offset}`
                );
        }

        // Every skip must be a DECLARED binary format or a symlink: a file that
        // silently fell out of the scan is the failure mode of the scan.
        expect(unreadable, "tracked files the scan could not read").toEqual([]);
        expect(
            tracked.some((t) => t.rel === ORIGIN_FILE),
            `${ORIGIN_FILE} is not in the scanned set — the guard no longer reaches the file whose NUL motivated it`
        ).toBe(true);
        expect(scanned).toBeGreaterThan(1000);

        expect(
            offenders,
            `control byte in a text source — grep and rg will skip the WHOLE file silently (issue #2221). ` +
                `Write the character as an escape (\\u0000) instead of embedding it:\n${offenders.join(
                    "\n"
                )}`
        ).toEqual([]);
    });
});
