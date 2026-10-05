/**
 * Issue #4860 (PRD #4849, ADR 0113 Amendment IV) — the contract step: a
 * hand-written Card Definition has ONE shape, `export const x = defineCard(…)`.
 * The eager `export const x: CardDefinition = { … }` is refused: the catalogue
 * reads only factories, so an eager one would silently vanish from the
 * Definition Index. This guard turns that silence into a red naming the file
 * and the shape to use.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCardExport } from "../defineCard";
import { defineCard } from "../types";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SETS_DIR = join(REPO_ROOT, "convex/cards/sets");

/** A top-level eager definition: `export const x: CardDefinition = …`. */
const EAGER_DEFINITION =
    /^export const\s+([A-Za-z0-9_$]+)\s*:\s*CardDefinition\s*=/;

/** One message per eager definition in `source`, naming `file` and the shape. */
export function eagerDefinitionViolations(
    file: string,
    source: string
): string[] {
    const violations: string[] = [];
    source.split("\n").forEach((line, i) => {
        const m = EAGER_DEFINITION.exec(line);
        if (m === null) return;
        violations.push(
            `${file}:${i + 1}: \`${m[1]}\` is an eager definition. ` +
                `Declare it as \`export const ${m[1]} = defineCard(() => ({ … }))\`.`
        );
    });
    return violations;
}

function setCardFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return setCardFiles(path);
        return entry.name.endsWith(".ts") ? [path] : [];
    });
}

describe("no eager hand-written definition (issue #4860)", () => {
    it("the detector names the file, the line and the factory shape", () => {
        const source = [
            "export const lightningBolt = defineCard(() => ({",
            "}));",
            "export const shock: CardDefinition = {",
            "};",
        ].join("\n");
        expect(
            eagerDefinitionViolations("sets/x/red.cards.ts", source)
        ).toEqual([
            "sets/x/red.cards.ts:3: `shock` is an eager definition. " +
                "Declare it as `export const shock = defineCard(() => ({ … }))`.",
        ]);
    });

    it("a commented stub and a non-card export are not eager definitions", () => {
        const source = [
            "// export const stub: CardDefinition = {",
            "export const sharedAbility: TriggeredAbility = {",
        ].join("\n");
        expect(eagerDefinitionViolations("f.ts", source)).toEqual([]);
    });

    it("no Set module declares one", () => {
        const violations = setCardFiles(SETS_DIR).flatMap((file) =>
            eagerDefinitionViolations(
                relative(REPO_ROOT, file),
                readFileSync(file, "utf8")
            )
        );
        expect(violations).toEqual([]);
    });

    it("the catalogue's one reader resolves a factory and refuses an eager object", () => {
        const def = { id: "x", name: "X", types: ["Instant"] } as never;
        expect(resolveCardExport(defineCard(() => def))).toBe(def);
        expect(resolveCardExport(def)).toBeUndefined();
    });
});
