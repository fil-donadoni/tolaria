import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * The two isolation promises of the Combo Corpus (ADR 0164 § 1, issue #8416).
 *
 * The corpus is a measure, read by scripts: a Bot seam reads only the derived
 * `data/combos/executable.json`, so nothing in the engine or the client may
 * reach `corpus.json`, nor the module describing it. And the import downloads
 * ~730 MB while gates and bootstrap are offline by contract, so no script may
 * call it but the owner's own `bun run`.
 *
 * Test files count too: a test reading the corpus from `convex/` or `src/` is
 * an engine or client dependency on a file only a re-import should move.
 */

const ROOT = resolve(__dirname, "../..");
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "_generated"]);

/** Any path into `data/combos/` but the derived slice ADR 0164 § 3 opens up. */
const CORPUS_REFERENCE =
    /data\/combos\/(?!executable\.json)|lib\/combo-corpus|combos-import/;
const IMPORT_REFERENCE = /combos[:-]import/;

/** The importer and its own module and tests are the only ones to name it. */
const IMPORT_ITSELF = new Set([
    "scripts/combos-import.ts",
    "scripts/lib/combo-corpus.ts",
]);

function walk(dir: string, accept: RegExp, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (SKIPPED_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, accept, out);
        else if (accept.test(entry)) out.push(full);
    }
    return out;
}

function offenders(
    dirs: readonly string[],
    accept: RegExp,
    reference: RegExp
): string[] {
    const hits: string[] = [];
    for (const dir of dirs) {
        const absolute = join(ROOT, dir);
        if (!existsSync(absolute)) continue;
        for (const file of walk(absolute, accept)) {
            const rel = relative(ROOT, file).replaceAll("\\", "/");
            for (const [index, text] of readFileSync(file, "utf8")
                .split("\n")
                .entries()) {
                if (reference.test(text)) hits.push(`${rel}:${index + 1}`);
            }
        }
    }
    return hits;
}

describe("the Combo Corpus seam (ADR 0164 § 1)", () => {
    it("nothing under the engine or the client reaches the corpus", () => {
        expect(
            offenders(["convex", "src"], SOURCE_FILE, CORPUS_REFERENCE)
        ).toEqual([]);
    });
});

describe("the import stays explicit (issue #8416)", () => {
    it("is registered under its own package script", () => {
        const { scripts } = JSON.parse(
            readFileSync(join(ROOT, "package.json"), "utf8")
        ) as {
            scripts: Record<string, string>;
        };
        expect(scripts["combos:import"]).toBe("bun scripts/combos-import.ts");
    });

    it("no other package script reaches it", () => {
        const { scripts } = JSON.parse(
            readFileSync(join(ROOT, "package.json"), "utf8")
        ) as {
            scripts: Record<string, string>;
        };
        const callers = Object.entries(scripts)
            .filter(
                ([name, command]) =>
                    name !== "combos:import" && IMPORT_REFERENCE.test(command)
            )
            .map(([name]) => name);
        expect(callers).toEqual([]);
    });

    it("no gate, bootstrap or workflow file reaches it", () => {
        const hits = offenders(
            ["scripts", ".github", ".husky", ".githooks"],
            /\.(?:[cm]?[jt]sx?|ya?ml|sh)$|^[a-z-]+$/,
            IMPORT_REFERENCE
        ).filter((hit) => {
            const file = hit.slice(0, hit.lastIndexOf(":"));
            return !IMPORT_ITSELF.has(file) && !/(^|\/)__tests__\//.test(file);
        });
        expect(hits).toEqual([]);
    });
});
