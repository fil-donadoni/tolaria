import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REGENERATE_MARKER } from "../lib/generated-artifacts";
import type { CardRow, Lockfile } from "../lib/oracle-lockfile";
import {
    BOT_VERDICT_OVERLAY_PATH,
    overlayBranchVerdicts,
} from "../lib/oracle-verdict-overlay";

/**
 * Issue #5814: a Bot-play verdict a PR replayed (`--carry-bot --replay-card`)
 * was dropped when `land`'s rebase conflicted on the lockfile — the driver
 * took the base's file and `--carry-bot` carried the base's verdicts. PR #5752
 * landed Stasis's fix without Stasis's `played`.
 */

function row(
    oracleId: string,
    botReach?: CardRow["botReach"],
    botGap?: string
): CardRow {
    return {
        oracleId,
        name: oracleId,
        state: "ready",
        ...(botReach ? { botReach } : {}),
        ...(botGap ? { botGap } : {}),
    };
}

function lock(cards: CardRow[], tag = ""): Lockfile {
    return {
        generator: tag,
        header: {} as Lockfile["header"],
        fragments: [],
        botGaps: [],
        cards,
    };
}

const GAP = "never-chosen › Enchantment › if+mayPay+sacrifice";

describe("overlayBranchVerdicts", () => {
    it("keeps the verdict the commit replayed over the side taken", () => {
        const base = lock([
            row("stasis", "ignored", GAP),
            row("bolt", "played"),
        ]);
        const ours = lock(
            [row("stasis", "ignored", GAP), row("bolt", "played"), row("new")],
            "ours"
        );
        const theirs = lock([row("stasis", "played"), row("bolt", "played")]);
        const { lock: out, carried } = overlayBranchVerdicts(
            base,
            ours,
            theirs
        );
        expect(carried).toBe(1);
        expect(out.generator).toBe("ours");
        expect(out.cards).toEqual([
            row("stasis", "played"),
            row("bolt", "played"),
            row("new"),
        ]);
    });

    it("leaves OURS untouched where the commit changed no verdict", () => {
        // ours re-played bolt (base moved); theirs did not touch it.
        const base = lock([row("bolt", "ignored", GAP)]);
        const ours = lock([row("bolt", "played")]);
        const theirs = lock([row("bolt", "ignored", GAP)]);
        const result = overlayBranchVerdicts(base, ours, theirs);
        expect(result.carried).toBe(0);
        expect(result.lock).toBe(ours);
    });

    it("a gap key change alone is a changed verdict", () => {
        const base = lock([row("x", "ignored", "a")]);
        const theirs = lock([row("x", "ignored", "b")]);
        const { lock: out } = overlayBranchVerdicts(base, base, theirs);
        expect(out.cards[0]!.botGap).toBe("b");
    });

    it("an unreadable base carries nothing: inherited is not changed", () => {
        const ours = lock([row("x", "played")]);
        const theirs = lock([row("x", "ignored", GAP)]);
        const result = overlayBranchVerdicts(null, ours, theirs);
        expect(result.carried).toBe(0);
        expect(result.lock).toBe(ours);
    });
});

describe("merge-driver-regenerated on the lockfile (real driver)", () => {
    const DRIVER = resolve(__dirname, "..", "merge-driver-regenerated.ts");
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-overlay-"));
        spawnSync("git", ["init", "-q"], { cwd: dir });
    });
    afterEach(() =>
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    function runDriver(path: string, theirsText?: string): Lockfile {
        // Pretty-printed so the stasis line and the bolt line are the ones
        // that collide: a real 3-way conflict, as on `land`'s rebase.
        const write = (name: string, l: Lockfile) =>
            writeFileSync(join(dir, name), JSON.stringify(l, null, 2));
        write(
            "base",
            lock([row("stasis", "ignored", GAP), row("bolt", "ignored", GAP)])
        );
        write(
            "ours",
            lock([row("stasis", "ignored", GAP), row("bolt", "played")], "ours")
        );
        write(
            "theirs",
            lock([row("stasis", "played"), row("bolt", "frozen", GAP)])
        );
        if (theirsText !== undefined)
            writeFileSync(join(dir, "theirs"), theirsText);
        const r = spawnSync("bun", [DRIVER, "base", "ours", "theirs", path], {
            cwd: dir,
            encoding: "utf8",
        });
        expect(r.status, r.stderr).toBe(0);
        // The side taken is always marked for the resolver's regeneration.
        const marker = spawnSync(
            "git",
            ["rev-parse", "--git-path", REGENERATE_MARKER],
            { cwd: dir, encoding: "utf8" }
        ).stdout.trim();
        expect(readFileSync(resolve(dir, marker), "utf8")).toContain(path);
        return JSON.parse(readFileSync(join(dir, "ours"), "utf8")) as Lockfile;
    }

    it("lays the commit's verdicts over the side it takes", () => {
        const out = runDriver(BOT_VERDICT_OVERLAY_PATH);
        expect(out.generator).toBe("ours");
        expect(out.cards).toEqual([
            row("stasis", "played"),
            row("bolt", "frozen", GAP),
        ]);
    });

    it("takes OURS byte-for-byte on any other regenerated artifact", () => {
        const out = runDriver("data/oracle-legality.json");
        expect(out.cards).toEqual([
            row("stasis", "ignored", GAP),
            row("bolt", "played"),
        ]);
    });

    it("a side the overlay cannot read leaves OURS, still marked, exit 0", () => {
        // Valid JSON, wrong shape: a card row that is not an object makes
        // the overlay throw, which must not cost the marker.
        const out = runDriver(
            BOT_VERDICT_OVERLAY_PATH,
            JSON.stringify({ cards: [null, 1] }, null, 2)
        );
        expect(out.generator).toBe("ours");
        expect(out.cards).toEqual([
            row("stasis", "ignored", GAP),
            row("bolt", "played"),
        ]);
    });
});
