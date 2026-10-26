// Static guard for issue #2792 (WCAG 2.5.8, ADR 0101 §2): the dense Button
// rungs (`xs`, `icon`, `icon-sm`, `icon-xs`) get their coarse-pointer 44px
// floor from `min-h/min-w: var(--touch-min)`. `cn` is `twMerge(clsx(…))`, so
// a consumer `min-h-*` / `min-w-*` / `h-*` / `size-*` class silently replaces
// that floor. This scan reds on any such class that does not reference
// `--touch-min` or `--control-h`, unless the consumer has an allowlist row
// naming an open issue (`tracked-by: #NNN`).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const REPO_ROOT = resolve(__dirname, "../../../..");
const SRC = join(REPO_ROOT, "src");

const DENSE_SIZES = new Set(["xs", "icon", "icon-sm", "icon-xs"]);
/** Components whose `size` defaults to a dense rung when the prop is absent. */
const DEFAULT_SIZE: Record<string, string> = {
    Button: "default",
    DebugButton: "xs",
};

/** Utilities that replace the variant's floor through tailwind-merge. */
const OVERRIDE_UTILITY =
    /(?:^|\s)(?:[\w-]+:)*(?:min-h|min-w|h|size)-(?:\[[^\]\s]*\]|[^\s]+)/g;
const SAFE_REFERENCE = /--touch-min|--control-h/;

/** `file:line` → `tracked-by: #NNN` of an OPEN sibling issue. */
export const ALLOWLIST: readonly { file: string; trackedBy: string }[] = [];

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (name === "__tests__" || name === "node_modules") continue;
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith(".tsx")) out.push(full);
    }
    return out;
}

function stringLiterals(node: ts.Node): string[] {
    const found: string[] = [];
    const visit = (n: ts.Node) => {
        if (ts.isStringLiteralLike(n)) found.push(n.text);
        else if (ts.isTemplateExpression(n)) {
            found.push(
                n.head.text,
                ...n.templateSpans.map((s) => s.literal.text)
            );
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
}

export interface Offender {
    file: string;
    line: number;
    classes: string;
}

/** Offending dense-size `<Button>` / `<DebugButton>` elements in `source`. */
export function findOffenders(source: string, file: string): Offender[] {
    const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
    );
    const offenders: Offender[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const tag = node.tagName.getText(sf);
            if (tag in DEFAULT_SIZE) {
                let size = DEFAULT_SIZE[tag];
                let className = "";
                for (const attr of node.attributes.properties) {
                    if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
                    const name = attr.name.getText(sf);
                    if (name === "size") {
                        const lits = stringLiterals(attr.initializer);
                        // A dynamic size: treat as dense when any literal is.
                        if (lits.length > 0) {
                            size =
                                lits.find((l) => DENSE_SIZES.has(l)) ?? lits[0];
                        }
                    } else if (name === "className") {
                        className = stringLiterals(attr.initializer).join(" ");
                    }
                }
                if (DENSE_SIZES.has(size)) {
                    const bad = (
                        className.match(OVERRIDE_UTILITY) ?? []
                    ).filter((u) => !SAFE_REFERENCE.test(u));
                    if (bad.length > 0) {
                        offenders.push({
                            file,
                            line:
                                sf.getLineAndCharacterOfPosition(
                                    node.getStart(sf)
                                ).line + 1,
                            classes: bad.map((b) => b.trim()).join(" "),
                        });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return offenders;
}

describe("Button dense rungs keep the --touch-min floor (issue #2792)", () => {
    it("no dense-size Button className overrides the floor", () => {
        const allowed = new Set(ALLOWLIST.map((r) => r.file));
        const offenders = walk(SRC).flatMap((full) => {
            const rel = relative(REPO_ROOT, full);
            return findOffenders(readFileSync(full, "utf8"), rel).filter(
                (o) => !allowed.has(o.file)
            );
        });
        expect(
            offenders.map((o) => `${o.file}:${o.line} ${o.classes}`)
        ).toEqual([]);
    });

    it("every allowlist row names an open-issue tracker", () => {
        expect(Array.isArray(ALLOWLIST)).toBe(true);
        for (const row of ALLOWLIST) {
            expect(row.trackedBy).toMatch(/^#\d+$/);
        }
    });

    it("reds on a bare min-h-6 on a dense Button (proof of failure)", () => {
        const bad = `const x = <Button size="xs" className="min-h-6 rounded">a</Button>;`;
        expect(findOffenders(bad, "x.tsx")).toHaveLength(1);
        const ok = `const x = <Button size="xs" className="min-h-[max(var(--touch-min),1.5rem)]">a</Button>;`;
        expect(findOffenders(ok, "x.tsx")).toHaveLength(0);
        const notDense = `const x = <Button size="sm" className="min-h-6">a</Button>;`;
        expect(findOffenders(notDense, "x.tsx")).toHaveLength(0);
    });
});
