import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";
import * as clientEntry from "../../convex/cards/client";

/**
 * Every value a bundled `src/` file imports from the bare `@convex/cards`
 * specifier is exported by the CLIENT entry (issue #9206).
 *
 * The two resolvers disagree by design: `tsconfig` maps `@convex/cards` to
 * the barrel (`convex/cards/index.ts`, registry + catalogue), and so does
 * vitest's alias; `vite.config.ts` maps it, by an exact-regex alias, to
 * `convex/cards/client.ts` (registry only), which keeps the catalogue out of
 * the main bundle. A catalogue name imported from the bare specifier is
 * green under `check:ts` and every vitest project and dies only in
 * `vite build` with `[MISSING_EXPORT]` — issue #2530 (`getAllCards`),
 * then the health RED of issue #9206 (`resolveCardName`). `check:bundle`
 * is health-only (ADR 0154 §3, 12–24 s), so without this sweep the lane
 * never sees the mistake.
 *
 * Type-only specifiers are allowed: the bundler erases them. Test files are
 * excluded: vitest resolves `@convex/cards` to the barrel, and no test is
 * bundled.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const SPECIFIER = "@convex/cards";
const CLIENT_ENTRY = "convex/cards/client.ts";

function isTestPath(filePath: string): boolean {
    return (
        filePath.includes(`${path.sep}__tests__${path.sep}`) ||
        /\.test\.tsx?$/.test(filePath)
    );
}

function bundledSources(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) bundledSources(full, out);
        else if (/\.tsx?$/.test(entry.name) && !isTestPath(full))
            out.push(full);
    }
    return out;
}

/** The value names `source` imports or re-exports from `SPECIFIER`; `"*"`
 *  for a namespace binding or `export *`, which take every export. */
function valueImportsOfSpecifier(fileName: string, source: string): string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest);
    const names: string[] = [];
    for (const statement of file.statements) {
        if (
            ts.isImportDeclaration(statement) &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            statement.moduleSpecifier.text === SPECIFIER
        ) {
            const clause = statement.importClause;
            if (!clause || clause.isTypeOnly) continue;
            if (clause.name) names.push("default");
            const bindings = clause.namedBindings;
            if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
            if (bindings && ts.isNamedImports(bindings)) {
                for (const element of bindings.elements) {
                    if (element.isTypeOnly) continue;
                    names.push((element.propertyName ?? element.name).text);
                }
            }
        }
        if (
            ts.isExportDeclaration(statement) &&
            statement.moduleSpecifier &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            statement.moduleSpecifier.text === SPECIFIER &&
            !statement.isTypeOnly
        ) {
            const clause = statement.exportClause;
            if (!clause || !ts.isNamedExports(clause)) {
                names.push("*");
                continue;
            }
            for (const element of clause.elements) {
                if (element.isTypeOnly) continue;
                names.push((element.propertyName ?? element.name).text);
            }
        }
    }
    return names;
}

describe("client entry imports (issue #9206, issue #2530)", () => {
    it("vite.config.ts still maps the bare @convex/cards to the client entry", () => {
        const config = fs.readFileSync(
            path.join(REPO_ROOT, "vite.config.ts"),
            "utf8"
        );
        expect(
            /find:\s*\/\^@convex\\\/cards\$\/,\s*replacement:\s*path\.resolve\(__dirname,\s*"convex\/cards\/client\.ts"\)/.test(
                config
            ),
            "the sweep below checks imports against the client entry because " +
                "Vite resolves the bare specifier there; if the alias moved, " +
                "re-point CLIENT_ENTRY at its new replacement"
        ).toBe(true);
    });

    it("no bundled src/ file imports a value the client entry does not export", () => {
        const exported = new Set(Object.keys(clientEntry));
        const offenders: string[] = [];
        let checked = 0;
        for (const file of bundledSources(SRC_ROOT)) {
            const source = fs.readFileSync(file, "utf8");
            if (!source.includes(SPECIFIER)) continue;
            for (const name of valueImportsOfSpecifier(file, source)) {
                checked++;
                if (name === "*" || !exported.has(name)) {
                    offenders.push(
                        `${path.relative(REPO_ROOT, file)}: ${name}`
                    );
                }
            }
        }
        expect(checked, "the sweep found no import to check").toBeGreaterThan(
            0
        );
        expect(
            offenders,
            `Vite resolves "${SPECIFIER}" to ${CLIENT_ENTRY}, which does not ` +
                "export these (tsc and vitest resolve the barrel, so only " +
                "`vite build` would fail). Import catalogue readers from " +
                `"${SPECIFIER}/catalogue" instead.`
        ).toEqual([]);
    });
});
