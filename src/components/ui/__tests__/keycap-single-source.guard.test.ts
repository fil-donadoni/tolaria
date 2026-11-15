// lane-scans: src/**
// Static guard for issue #9833: ONE keycap primitive draws every hotkey the UI
// shows (`ui/keycap.tsx`), from the declarations in `~/lib/hotkeys`. Before
// it, five components drew their own bordered `<kbd>` and the controller's
// buttons printed bare `[P]` / `[A]` hints, each a separate opinion about how
// a key looks and, worse, a separate hand-typed copy of WHICH key it is.
//
// This scan reds on (a) a `<kbd>` element in any `.tsx` under `src/` other
// than the keycap itself, and (b) a bracketed key hint — `[P]`, `[Space]`,
// `[Enter]`, `[Esc]` — in JSX text or a string literal (a `title`, a label).
// Comments are not scanned: the AST walk never visits them.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const REPO_ROOT = resolve(__dirname, "../../../..");
const SRC = join(REPO_ROOT, "src");
const KEYCAP = "src/components/ui/keycap.tsx";

const BRACKET_HINT = /\[(?:[A-Z`]|Space|Enter|Esc|Escape|Tab)\]/;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (name === "__tests__" || name === "node_modules") continue;
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith(".tsx")) out.push(full);
    }
    return out;
}

export function offenders(file: string, text: string): string[] {
    const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
    );
    const found: string[] = [];
    const at = (n: ts.Node) =>
        `${file}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const visit = (n: ts.Node) => {
        if (
            (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
            n.tagName.getText(source) === "kbd" &&
            file !== KEYCAP
        ) {
            found.push(`${at(n)} draws its own <kbd>`);
        }
        if (
            (ts.isJsxText(n) || ts.isStringLiteralLike(n)) &&
            BRACKET_HINT.test(n.text)
        ) {
            found.push(
                `${at(n)} prints a bracketed key hint "${n.text.trim()}"`
            );
        }
        ts.forEachChild(n, visit);
    };
    visit(source);
    return found;
}

describe("one keycap primitive (issue #9833)", () => {
    it("no component outside ui/keycap draws a <kbd> or a [X] hint", () => {
        const found = walk(SRC).flatMap((full) =>
            offenders(relative(REPO_ROOT, full), readFileSync(full, "utf8"))
        );
        expect(found).toEqual([]);
    });

    it("the scan sees both shapes it forbids", () => {
        expect(
            offenders(
                "src/x.tsx",
                `const a = <span><kbd>C</kbd> <i title="Pass Turn [P]" /> [A]</span>;`
            )
        ).toHaveLength(3);
        expect(
            offenders(KEYCAP, `const a = <kbd data-slot="kbd">P</kbd>;`)
        ).toEqual([]);
        expect(
            offenders(
                "src/x.tsx",
                `// a comment naming [P] is fine\nconst a = 1;`
            )
        ).toEqual([]);
    });
});
