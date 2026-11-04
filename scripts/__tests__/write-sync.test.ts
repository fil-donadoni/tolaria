import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeSyncAll } from "../lib/write-sync";

const LIB = resolve(__dirname, "../lib/write-sync.ts");

/** A child replaying 8 MB on a piped stderr, then exiting 1 the way
 *  `check:lane` does — `how` picks the write. */
function run(how: "async" | "sync"): string {
    const dir = mkdtempSync(join(tmpdir(), "write-sync-"));
    const script = join(dir, "child.ts");
    const body = "x".repeat(8 * 1024 * 1024) + "\nLAST-LINE\n";
    writeFileSync(
        script,
        `import { writeSyncAll } from ${JSON.stringify(LIB)};
const body = ${JSON.stringify(body)};
${how === "sync" ? "writeSyncAll(2, body);" : "process.stderr.write(body);"}
process.exit(1);
`
    );
    const r = spawnSync("bun", [script], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
    expect(r.status).toBe(1);
    return r.stderr;
}

describe("writeSyncAll (issue #8180)", () => {
    it("a megabyte replay on a piped stderr survives the process.exit after it", () => {
        expect(run("sync")).toMatch(/LAST-LINE\n$/);
    });

    it("retries EAGAIN and finishes a partial write", () => {
        const got: string[] = [];
        let calls = 0;
        const write = ((_fd: number, buf: Buffer, off: number) => {
            calls += 1;
            if (calls === 1) {
                const e = new Error("full") as NodeJS.ErrnoException;
                e.code = "EAGAIN";
                throw e;
            }
            got.push(buf.subarray(off, off + 2).toString());
            return Math.min(2, buf.length - off);
        }) as never;
        writeSyncAll(2, "abcde", write);
        expect(got.join("")).toBe("abcde");
    });
});
