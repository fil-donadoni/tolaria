// The lane's decision over derived whole-file state (ADR 0157, issue #6246).
import { describe, expect, it } from "vitest";
import {
    TREE_ROLE_ENV,
    derivedProblems,
    firstRowDrift,
    treeRole,
} from "../lib/derived-state";
import { withTreeHashes } from "../derive-regenerate";
import { buildCatalogue } from "../catalogue-artifact";
import { parseLockfile, serializeLockfile } from "../lib/oracle-lockfile";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const row = (oracleId: string, name: string, extra = "") => ({
    oracleId,
    name,
    extra,
});

describe("derivedProblems — the lane's decision", () => {
    const stale = {
        headerDrift: "compiler hash drift",
        rowDrift: null,
        catalogueStale: true,
    };

    it("a draft whose committed header and catalogue are stale but whose rows are right is green", () => {
        expect(derivedProblems("draft", stale)).toEqual([]);
    });

    it("a draft with one wrong row is red, and names it", () => {
        const rowDrift = firstRowDrift(
            [row("a", "Alpha"), row("b", "Beta", "wrong")],
            [row("a", "Alpha"), row("b", "Beta")]
        );
        expect(rowDrift).toContain("Beta");
        expect(derivedProblems("draft", { ...stale, rowDrift })).toEqual([
            rowDrift,
        ]);
    });

    it("the base keeps every tier: stale header and stale catalogue are red", () => {
        expect(derivedProblems("base", stale)).toHaveLength(2);
    });

    it("rows agreeing, in any order, are no drift; an extra or missing row is", () => {
        const a = row("a", "Alpha");
        const b = row("b", "Beta");
        expect(firstRowDrift([a, b], [b, a])).toBeNull();
        expect(firstRowDrift([a], [a, b])).toContain("not committed");
        expect(firstRowDrift([a, b], [a])).toContain("no longer produces");
    });

    it("the role is read from the environment, defaulting to base", () => {
        expect(treeRole({})).toBe("base");
        expect(treeRole({ [TREE_ROLE_ENV]: "draft" })).toBe("draft");
        expect(treeRole({ [TREE_ROLE_ENV]: "x" })).toBe("base");
    });
});

describe("regeneration is deterministic (ADR 0157)", () => {
    it("two catalogue builds of the same tree are byte-identical", () => {
        const one = buildCatalogue(ROOT);
        const two = buildCatalogue(ROOT);
        expect(two.packedBytes).toBe(one.packedBytes);
        expect(two.definitionIndexBytes).toBe(one.definitionIndexBytes);
        expect(two.searchIndexBytes).toBe(one.searchIndexBytes);
        expect(two.sourceHashBytes).toBe(one.sourceHashBytes);
    });

    it("rewriting the header hashes twice is idempotent and keeps every row", () => {
        const lock = parseLockfile(
            readFileSync(resolve(ROOT, "data", "oracle-compiled.json"), "utf8")
        );
        const hashes = {
            compilerHash: "sha256:c",
            registryHash: "sha256:r",
            poolHash: "sha256:p",
        };
        const once = withTreeHashes(lock, hashes);
        const twice = withTreeHashes(once, hashes);
        expect(serializeLockfile(twice)).toBe(serializeLockfile(once));
        expect(once.cards).toBe(lock.cards);
        expect(once.header.compilerHash).toBe("sha256:c");
    });
});
