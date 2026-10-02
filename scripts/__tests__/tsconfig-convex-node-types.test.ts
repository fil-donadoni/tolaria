import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

/**
 * A tsc project that maps `@convex/*` can reach Convex server modules —
 * through a type-only re-export as much as a value import — and those run
 * with `process.env` (issue #4949). A project that RESTRICTS `types` must
 * therefore list `node`, or the first server module its program reaches
 * fails `check:ts` with "Cannot find name 'process'".
 *
 * Observed: PR #4946 re-exported a type from `convex/decks.ts` in
 * `src/types/game.ts`; `tsconfig.dashboard.json` (`types: ["vite/client"]`)
 * reached `convex/auth.ts` → `resendOtpPasswordReset.ts` and went red on a
 * fresh worktree (health RED @ ec54045), while `tsconfig.app.json` passed only
 * because `undici-types` happened to reference Node's types. An incremental
 * `tsc -b` in the landing worktree reported green, so only health saw it —
 * this check is static and needs no build.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

interface Project {
    file: string;
    types: string[] | undefined;
    mapsConvex: boolean;
    compiles: boolean;
}

function readProject(file: string): Project {
    const raw = ts.parseConfigFileTextToJson(
        file,
        fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
    );
    if (raw.error) throw new Error(`${file}: unparsable`);
    const cfg = raw.config as {
        compilerOptions?: { types?: string[]; paths?: Record<string, unknown> };
        include?: string[];
        files?: string[];
    };
    return {
        file,
        types: cfg.compilerOptions?.types,
        mapsConvex: Object.keys(cfg.compilerOptions?.paths ?? {}).includes(
            "@convex/*"
        ),
        // A solution file (`files: []`, references only) compiles nothing.
        compiles:
            (cfg.include?.length ?? 0) > 0 || (cfg.files?.length ?? 0) > 0,
    };
}

const PROJECTS = fs
    .readdirSync(REPO_ROOT)
    .filter((f) => /^tsconfig(\..+)?\.json$/.test(f))
    .map(readProject);

describe("tsconfig — a project that can reach Convex server code has Node types (issue #4949)", () => {
    it("finds the projects that map @convex/*", () => {
        // Vacuity guard: a rename of the alias must not empty the sweep.
        expect(
            PROJECTS.filter((p) => p.compiles && p.mapsConvex).map(
                (p) => p.file
            )
        ).toEqual(
            expect.arrayContaining([
                "tsconfig.app.json",
                "tsconfig.dashboard.json",
            ])
        );
    });

    it.each(
        PROJECTS.filter((p) => p.compiles && p.mapsConvex).map((p) => p.file)
    )("%s lists node whenever it restricts types", (file) => {
        // Re-read here: the block exercises the reader it relies on, never a
        // value computed at load (check:test-hygiene, issue #4955).
        const { types } = readProject(file);
        if (types === undefined) return; // unrestricted: every @types loads
        expect(types).toContain("node");
    });
});
