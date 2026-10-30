// `landingWalkOwed` judges content rules on the diff's CHANGED LINES, never on
// what an untouched part of the file already declares (owner ruling, issue
// #7592). Driven against a real git repository: the merge-base diff, the
// untracked-file leg and the fail-closed leg are all git behaviour a stubbed
// reader cannot prove.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    changedLinesOfDiff,
    landingWalkOwed,
} from "../ui-gate/verify-receipt.ts";

const CARD = "src/components/board/hand-card.tsx";
const BASE = "base";

/** A leaf component that already declares a z-index, the shape of
 *  `gre-hand-card.tsx` (issue #3219's Plot diff). */
const WITH_Z = [
    "export function HandCard() {",
    "    const label = 'Cast';",
    "    return <div className='relative z-10'>{label}</div>;",
    "}",
    "",
].join("\n");

let repo: string;
const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
};
const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
};
const commit = () => {
    git("add", "-A");
    git("commit", "-q", "-m", "change");
};
const owed = (paths: string[]) => landingWalkOwed(paths, repo, BASE);

beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "tolaria-walk-owed-"));
    git("init", "-q", "-b", BASE);
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    write(CARD, WITH_Z);
    commit();
    git("checkout", "-q", "-b", "feature");
});
afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 10 }));

describe("landingWalkOwed — content rules read the changed lines (issue #7592)", () => {
    it("an edit beside an untouched z-index owes no walk", () => {
        write(CARD, WITH_Z.replace("'Cast'", "'Plot'"));
        commit();
        expect(owed([CARD])).toMatchObject({ owed: false });
    });

    it("an uncommitted edit is judged the same way", () => {
        write(CARD, WITH_Z.replace("'Cast'", "'Plot'"));
        expect(owed([CARD])).toMatchObject({ owed: false });
    });

    it("ADDING a z-index owes a walk", () => {
        write(
            CARD,
            WITH_Z + "export const Pill = () => <span className='z-20' />;\n"
        );
        commit();
        expect(owed([CARD])).toMatchObject({
            owed: true,
            rule: "declares a z-index",
            path: CARD,
        });
    });

    it("a bare `sticky` on the LAST changed line still owes a walk", () => {
        const multi = [
            "export const Bar = () => (",
            "    <div",
            "        className={`",
            "    top-0",
            "        `}",
            "    />",
            ");",
            "",
        ].join("\n");
        write(CARD, multi);
        commit();
        write(CARD, multi.replace("    top-0", "    top-0\n    sticky"));
        commit();
        // Against the previous commit, the bare `sticky` is the ONLY changed line.
        expect(landingWalkOwed([CARD], repo, "HEAD~1")).toMatchObject({
            owed: true,
            path: CARD,
        });
    });

    it("REMOVING a z-index owes a walk", () => {
        write(CARD, WITH_Z.replace(" z-10", ""));
        commit();
        expect(owed([CARD])).toMatchObject({ owed: true, path: CARD });
    });

    it("a new file counts whole, committed or untracked", () => {
        const fresh = "src/components/board/new-pill.tsx";
        write(
            fresh,
            "export const Pill = () => <span className='sticky top-0' />;\n"
        );
        expect(owed([fresh])).toMatchObject({ owed: true, path: fresh });
        commit();
        expect(owed([fresh])).toMatchObject({ owed: true, path: fresh });
    });

    it("a diff it cannot read stays owed (no merge-base: fail closed)", () => {
        write(CARD, WITH_Z.replace("'Cast'", "'Plot'"));
        commit();
        expect(landingWalkOwed([CARD], repo, "no-such-ref")).toMatchObject({
            owed: true,
            path: CARD,
        });
    });
});

describe("changedLinesOfDiff", () => {
    it("keeps hunk lines only: the ---/+++ headers are not content", () => {
        const diff = [
            "diff --git a/x.tsx b/x.tsx",
            "--- a/x.tsx",
            "+++ b/x.tsx",
            "@@ -1 +1 @@",
            "-const a = 1;",
            "+++counter;",
        ].join("\n");
        expect(changedLinesOfDiff(diff)).toBe("const a = 1;\n++counter;\n");
    });

    it("keeps a removed line that itself starts with dashes", () => {
        const diff = ["@@ -1 +0,0 @@", "--- a separator", "+"].join("\n");
        expect(changedLinesOfDiff(diff)).toBe("-- a separator\n\n");
    });
});
