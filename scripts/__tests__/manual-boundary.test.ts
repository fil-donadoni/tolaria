import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Manual Mode import-graph boundary guard (ADR 0080).
 *
 * `convex/manual.ts` and anything under a `convex/manual/` namespace must
 * import NOTHING from `convex/gre/`. This is what keeps ADR 0080's central
 * invariant — "the GRE never has to ask '…and what about manual mode?'" —
 * mechanical instead of aspirational. A convention alone erodes at the
 * first "just this once".
 *
 * Modeled on `bot-suite-boundary.test.ts` (vitest.config.ts subsystem split).
 * Both are scripts tests (fs walk) running in the node project.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const GRE_PREFIX = "convex/gre/";

/** Walk all .ts files under dir, returning repo-relative paths. */
function allTsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "_generated")
            continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            allTsFiles(full, out);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
            out.push(path.relative(REPO_ROOT, full));
        }
    }
    return out;
}

/** Collect every .ts file under the convex/manual/ directory AND the
 *  top-level convex/manual.ts. */
function manualFiles(): string[] {
    const files: string[] = [];
    if (fs.existsSync(path.join(REPO_ROOT, "convex/manual.ts"))) {
        files.push("convex/manual.ts");
    }
    const manualDir = path.join(REPO_ROOT, "convex/manual");
    if (fs.existsSync(manualDir)) {
        for (const f of allTsFiles(manualDir)) {
            files.push(f);
        }
    }
    return files;
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** Strip type-only imports — they are ERASED at compile time, never
 *  loading the module at runtime (mirrors bot-suite-boundary.test.ts). */
function stripTypeOnlyImports(source: string): string {
    return source.replace(
        /\b(?:import|export)\s+type\s+[^;]*?from\s*["'][^"']+["']/g,
        ""
    );
}

/** Resolves an import specifier to a repo-relative, extensionless path.
 *  Returns null for a bare package specifier (nothing to check). */
function resolveSpecifier(fromFile: string, spec: string): string | null {
    if (spec.startsWith(".")) {
        return path
            .relative(
                REPO_ROOT,
                path.resolve(path.dirname(path.join(REPO_ROOT, fromFile)), spec)
            )
            .replace(/\.(ts|tsx|js)$/, "");
    }
    if (spec.startsWith("@convex/")) {
        return path
            .join("convex", spec.slice("@convex/".length))
            .replace(/\.(ts|tsx|js)$/, "");
    }
    return null;
}

function isGreModule(resolved: string): boolean {
    return resolved.startsWith(GRE_PREFIX);
}

describe("manual mode import-graph boundary (ADR 0080)", () => {
    it("no file under convex/manual imports from convex/gre/", () => {
        const files = manualFiles();
        const violations: string[] = [];

        for (const file of files) {
            const source = stripTypeOnlyImports(
                fs.readFileSync(path.join(REPO_ROOT, file), "utf-8")
            );
            const hits = new Set<string>();
            for (const m of source.matchAll(IMPORT_RE)) {
                const resolved = resolveSpecifier(file, m[1]);
                if (resolved && isGreModule(resolved)) hits.add(resolved);
            }
            if (hits.size > 0) {
                violations.push(`${file} → ${[...hits].sort().join(", ")}`);
            }
        }

        expect(
            violations,
            `Manual mode files import from convex/gre/ — this breaks ADR 0080's ` +
                `central invariant (the GRE must never learn about manual mode):\n` +
                violations.join("\n")
        ).toEqual([]);
    });

    it("convex/manual.ts exists and imports nothing from convex/gre/", () => {
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "convex/manual.ts"),
            "utf-8"
        );
        const stripped = stripTypeOnlyImports(src);
        for (const m of stripped.matchAll(IMPORT_RE)) {
            const resolved = resolveSpecifier("convex/manual.ts", m[1]);
            if (resolved && isGreModule(resolved)) {
                throw new Error(
                    `convex/manual.ts imports ${resolved} from convex/gre/ — forbidden by ADR 0080`
                );
            }
        }
        // Pass: nothing violated.
        expect(true).toBe(true);
    });

    it("fails when a manual file deliberately imports convex/gre/", () => {
        // Proof-of-failure: an import via @convex/ alias MUST be flagged.
        const resolved = resolveSpecifier(
            "convex/manual.ts",
            "@convex/gre/state"
        );
        expect(resolved).not.toBeNull();
        expect(isGreModule(resolved!)).toBe(true);

        // The file itself must NOT contain a real gre/ import.
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "convex/manual.ts"),
            "utf-8"
        );
        const stripped = stripTypeOnlyImports(src);
        expect(
            [...stripped.matchAll(IMPORT_RE)].some((m) => {
                const r = resolveSpecifier("convex/manual.ts", m[1]);
                return r !== null && isGreModule(r);
            })
        ).toBe(false);
    });
});
