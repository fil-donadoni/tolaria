import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    mergeKeySetFile,
    mergeKeySets,
    serializeKeys,
    serializeRows,
} from "../lib/key-set-merge";
import { KEY_SET_MERGE_DRIVER_NAME } from "../lib/generated-artifacts";
import { BASE_BRANCH } from "../lib/branches";

/**
 * Guards for issue #6276 — the issue-log ratchet baseline is merged as a set of
 * keys, so adjacent or overlapping deletions (PR #6255's shape) never conflict.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const DRIVER = join(REPO_ROOT, "scripts", "merge-driver-key-set.ts");
const FILE = "baseline.json";
const text = (...keys: string[]) => serializeKeys(keys);

describe("mergeKeySets (pure)", () => {
    it("overlapping deletions on both sides: [a,b,c,d] minus b / minus b,c → [a,d]", () => {
        const r = mergeKeySets(
            text("a", "b", "c", "d"),
            text("a", "c", "d"),
            text("a", "d")
        );
        expect(r).toEqual({ ok: true, keys: ["a", "d"] });
    });

    it("disjoint additions are unioned and sorted", () => {
        const r = mergeKeySets(text("b"), text("b", "z"), text("a", "b"));
        expect(r).toEqual({ ok: true, keys: ["a", "b", "z"] });
    });

    it("an addition on one side and a removal on the other both apply", () => {
        const r = mergeKeySets(text("a", "b"), text("a", "b", "c"), text("a"));
        expect(r).toEqual({ ok: true, keys: ["a", "c"] });
    });

    it("an empty base (add/add) reads as an empty set", () => {
        expect(mergeKeySets("", text("a"), text("b"))).toEqual({
            ok: true,
            keys: ["a", "b"],
        });
    });

    it.each(["base", "ours", "theirs"] as const)(
        "malformed JSON on the %s side is an error",
        (side) => {
            const sides = {
                base: text("a"),
                ours: text("a"),
                theirs: text("a"),
            };
            sides[side] = "[ not json";
            const r = mergeKeySets(sides.base, sides.ours, sides.theirs);
            expect(r.ok).toBe(false);
        }
    );

    it("a non-array or non-string payload is an error", () => {
        expect(mergeKeySets("[]", '{"a":1}', "[]").ok).toBe(false);
        expect(mergeKeySets("[]", "[1]", "[]").ok).toBe(false);
    });
});

describe("mergeKeySetFile — rows keyed by `name` (issue #6648)", () => {
    const row = (name: string, extra: Record<string, unknown> = {}) => ({
        name,
        id: `id-${name}`,
        ...extra,
    });
    const rows = (...r: ReturnType<typeof row>[]) => serializeRows(r);

    it("unions rows both sides inserted, in localeCompare order", () => {
        expect(
            mergeKeySetFile(
                rows(row("a"), row("z")),
                rows(row("a"), row("b"), row("z")),
                rows(row("a"), row("B2"), row("z"))
            )
        ).toEqual({
            ok: true,
            text: rows(row("a"), row("b"), row("B2"), row("z")),
        });
    });

    it("takes the one side that changed a row, and applies a deletion", () => {
        expect(
            mergeKeySetFile(
                rows(row("a"), row("b")),
                rows(row("a", { rarity: "rare" }), row("b")),
                rows(row("a"))
            )
        ).toEqual({ ok: true, text: rows(row("a", { rarity: "rare" })) });
    });

    it("a row both sides changed differently is an error", () => {
        const r = mergeKeySetFile(
            rows(row("a")),
            rows(row("a", { rarity: "rare" })),
            rows(row("a", { rarity: "common" }))
        );
        expect(r.ok).toBe(false);
    });

    it("a side naming a row twice is an error", () => {
        expect(
            mergeKeySetFile(
                rows(row("a")),
                rows(row("a")),
                rows(row("a"), row("a"))
            ).ok
        ).toBe(false);
    });

    it("a plain key file still merges as a set of strings", () => {
        expect(
            mergeKeySetFile(text("b"), text("b", "z"), text("a", "b"))
        ).toEqual({
            ok: true,
            text: text("a", "b", "z"),
        });
    });
});

describe("mergeKeySetFile — a JSON object keyed map (issue #7871)", () => {
    // `data/pick-ratings/*.json`: `{ setCode, ratings: { <scryfallId>: n } }`.
    // A tail append moves the last line's trailing comma, so two PRs conflict
    // as text without disagreeing — PR #7811 went `land-failed` four times on
    // it. Hence sorted keys (ADR 0165), and the driver for what is left.
    const file = (ratings: Record<string, number>, setCode = "cube") =>
        `${JSON.stringify({ setCode, ratings }, null, 4)}\n`;

    it("two tail appends merge cleanly, every nested map sorted by key (ADR 0165)", () => {
        expect(
            mergeKeySetFile(
                file({ z: 3, a: 2 }),
                file({ z: 3, a: 2, m: 4 }),
                file({ z: 3, a: 2, b: 1.5 })
            )
        ).toEqual({ ok: true, text: file({ a: 2, b: 1.5, m: 4, z: 3 }) });
    });

    it("keeps the top level as written: `setCode` stays above `ratings`", () => {
        const r = mergeKeySetFile(
            file({ a: 1 }),
            file({ a: 1, b: 2 }),
            file({ a: 1, c: 3 })
        );
        expect(r.ok && Object.keys(JSON.parse(r.text))).toEqual([
            "setCode",
            "ratings",
        ]);
    });

    it("one side's change and the other's deletion both apply", () => {
        expect(
            mergeKeySetFile(
                file({ a: 1, b: 2 }),
                file({ a: 5, b: 2 }),
                file({ a: 1 })
            )
        ).toEqual({ ok: true, text: file({ a: 5 }) });
    });

    it("both sides setting one key to the SAME value is not a conflict", () => {
        expect(
            mergeKeySetFile(file({ a: 1 }), file({ a: 2 }), file({ a: 2 }))
        ).toEqual({ ok: true, text: file({ a: 2 }) });
    });

    it("both sides setting one key to DIFFERENT values is an error naming it", () => {
        const r = mergeKeySetFile(
            file({ a: 1 }),
            file({ a: 2 }),
            file({ a: 3 })
        );
        expect(r).toEqual({
            ok: false,
            error: 'key "ratings.a" changed differently on both sides',
        });
    });

    it("a top-level scalar both sides changed differently is an error", () => {
        expect(
            mergeKeySetFile(
                file({ a: 1 }),
                file({ a: 1 }, "x"),
                file({ a: 1 }, "y")
            ).ok
        ).toBe(false);
    });

    it.each(["base", "ours", "theirs"] as const)(
        "a %s side that does not parse is an error",
        (side) => {
            const sides = {
                base: file({ a: 1 }),
                ours: file({ a: 1 }),
                theirs: file({ a: 1 }),
            };
            sides[side] = "{ not json";
            expect(
                mergeKeySetFile(sides.base, sides.ours, sides.theirs).ok
            ).toBe(false);
        }
    );

    it("a side of another shape (array vs object) is an error", () => {
        expect(mergeKeySetFile(file({ a: 1 }), "[]\n", file({ a: 1 })).ok).toBe(
            false
        );
    });

    it("every committed pick-ratings file is already in the canonical form", () => {
        for (const name of ["lea.json", "vintage-cube.json"]) {
            const t = readFileSync(
                join(REPO_ROOT, "data", "pick-ratings", name),
                "utf8"
            );
            expect(mergeKeySetFile(t, t, t), name).toEqual({
                ok: true,
                text: t,
            });
        }
    });
});

describe("key-set merge driver (real git)", () => {
    let dir: string;
    let repo: string;

    function git(args: string[]): string {
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        }
        return r.stdout.trim();
    }
    const commit = (message: string) => {
        git(["add", "-A"]);
        git(["commit", "-m", message]);
    };

    function useDriver(): void {
        writeFileSync(
            join(repo, ".gitattributes"),
            `${FILE} merge=${KEY_SET_MERGE_DRIVER_NAME}\n`
        );
        commit("gitattributes");
        git(["config", `merge.${KEY_SET_MERGE_DRIVER_NAME}.name`, "key-set"]);
        git([
            "config",
            `merge.${KEY_SET_MERGE_DRIVER_NAME}.driver`,
            `bun ${DRIVER} %O %A %B %P`,
        ]);
    }

    function divergeAndRebase(branch: string, main: string) {
        git(["checkout", "-q", "-b", "branch"]);
        writeFileSync(join(repo, FILE), branch);
        commit("branch deletes");
        git(["checkout", "-q", BASE_BRANCH]);
        writeFileSync(join(repo, FILE), main);
        commit("main deletes");
        git(["checkout", "-q", "branch"]);
        const r = spawnSync("git", ["rebase", BASE_BRANCH], {
            cwd: repo,
            encoding: "utf8",
        });
        return { status: r.status, output: r.stdout + r.stderr };
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-key-set-merge-"));
        repo = join(dir, "repo");
        mkdirSync(repo, { recursive: true });
        spawnSync("git", ["init", "-b", BASE_BRANCH, repo], { cwd: dir });
        git(["config", "user.email", "test@example.com"]);
        git(["config", "user.name", "Test"]);
        writeFileSync(join(repo, FILE), text("a", "b", "c", "d"));
        commit("base");
    });

    afterEach(() => {
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        });
    });

    it("WITHOUT the driver, adjacent deletions conflict (the bug)", () => {
        const r = divergeAndRebase(text("a", "d"), text("a", "c", "d"));
        expect(r.status).not.toBe(0);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });

    it("with the driver, the same rebase is clean and canonical", () => {
        useDriver();
        const r = divergeAndRebase(text("a", "d"), text("a", "c", "d"));
        expect(r.status, r.output).toBe(0);
        expect(readFileSync(join(repo, FILE), "utf8")).toBe(text("a", "d"));
    });

    it("with the driver, a malformed side stays a conflict", () => {
        useDriver();
        const r = divergeAndRebase("[ broken", text("a", "c", "d"));
        expect(r.status).not.toBe(0);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });

    // Issue #7871 — PR #7811's shape: two card PRs each append a rating at
    // the tail of `ratings`.
    const ratings = (r: Record<string, number>) =>
        `${JSON.stringify({ setCode: "cube", ratings: r }, null, 4)}\n`;

    it("WITHOUT the driver, two tail appends to a ratings map conflict (the bug)", () => {
        writeFileSync(join(repo, FILE), ratings({ z: 3, a: 2 }));
        commit("ratings base");
        const r = divergeAndRebase(
            ratings({ z: 3, a: 2, m: 4 }),
            ratings({ z: 3, a: 2, b: 1.5 })
        );
        expect(r.status).not.toBe(0);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });

    it("with the driver, two tail appends to a ratings map rebase cleanly", () => {
        writeFileSync(join(repo, FILE), ratings({ z: 3, a: 2 }));
        commit("ratings base");
        useDriver();
        const r = divergeAndRebase(
            ratings({ z: 3, a: 2, m: 4 }),
            ratings({ z: 3, a: 2, b: 1.5 })
        );
        expect(r.status, r.output).toBe(0);
        expect(readFileSync(join(repo, FILE), "utf8")).toBe(
            ratings({ a: 2, b: 1.5, m: 4, z: 3 })
        );
    });

    it("WITHOUT the driver, inserts at their sorted place do not conflict (ADR 0165)", () => {
        const pad = { c: 1, e: 1, g: 1, i: 1, k: 1 };
        writeFileSync(join(repo, FILE), ratings({ a: 1, ...pad, m: 1 }));
        commit("ratings base");
        const r = divergeAndRebase(
            ratings({ a: 1, b: 2, ...pad, m: 1 }),
            ratings({ a: 1, ...pad, l: 3, m: 1 })
        );
        expect(r.status, r.output).toBe(0);
        expect(
            JSON.parse(readFileSync(join(repo, FILE), "utf8")).ratings
        ).toEqual({ a: 1, b: 2, ...pad, l: 3, m: 1 });
    });
});
