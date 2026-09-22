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
 * classified the 851-line auto-tap solver as `data`, and `grep`/`ripgrep` skip
 * binary files SILENTLY: no match, no warning. The module was invisible to
 * every text search in the repo.
 *
 * It cost real work. The `/audit-tracker` pass on issue #1733 and a delegated
 * subagent census both concluded `getManaTapOptionRestriction` was dead code
 * with zero callers — `autoTap.ts:4` imports it and uses it. That conclusion
 * reached an issue body before someone read the file directly.
 *
 * A wrong "not found" is more expensive than a missing file, because nothing
 * signals it: the search exits 0 and prints a shorter list. Any agent mapping a
 * subsystem, any grep-based guard and any human running `rg` is affected the
 * same way. That is not something a paragraph in a rules file can prevent —
 * the defect is invisible in the diff that introduces it.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Extensions whose files are text by contract — a control byte in one of them
 *  is a mistake, never payload. Binary assets (images, fonts, archives) are
 *  simply not listed. */
const TEXT_EXTENSIONS = [
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".css",
    ".html",
    ".yml",
    ".yaml",
    ".sh",
    ".txt",
];

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

/** First forbidden control byte in `buf`, or null. Exported so the detector
 *  itself is testable — a scan that can never report anything would keep this
 *  guard green forever. */
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

function trackedTextFiles(): string[] {
    const out = execFileSync("git", ["ls-files", "-z"], {
        cwd: ROOT,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
    })
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
    return out.filter((rel) =>
        TEXT_EXTENSIONS.includes(path.extname(rel).toLowerCase())
    );
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
        const files = trackedTextFiles();
        // A path filter that silently matched nothing would make this green.
        expect(files.length).toBeGreaterThan(1000);

        const offenders: string[] = [];
        for (const rel of files) {
            const abs = path.join(ROOT, rel);
            if (!fs.existsSync(abs)) continue; // submodule / sparse checkout
            const hit = findControlByte(fs.readFileSync(abs));
            if (hit)
                offenders.push(
                    `${rel}:${hit.line} — byte 0x${hit.byte
                        .toString(16)
                        .padStart(2, "0")} at offset ${hit.offset}`
                );
        }

        expect(
            offenders,
            `control byte in a text source — grep and rg will skip the WHOLE file silently (issue #2221). ` +
                `Write the character as an escape (\\u0000) instead of embedding it:\n${offenders.join(
                    "\n"
                )}`
        ).toEqual([]);
    });
});
