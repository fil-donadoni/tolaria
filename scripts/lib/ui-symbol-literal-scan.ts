import * as fs from "fs";
import * as path from "path";
import ts from "typescript";
import { BRACE_TOKEN_RE, symbolName } from "../../src/lib/symbol-names";

/**
 * Raw symbol-token literal scan (issue #9834).
 *
 * The UI kit primitives render their string content through the symbol
 * parser (`withSymbols`, `src/lib/oracle-text.tsx`), so a `{T}` that reaches
 * a `Button`, a `GameDialog` title or a menu item draws the icon without the
 * call site doing anything. Two shapes bypass every primitive, and those are
 * what this scan reds on — a string or template literal holding a MAPPABLE
 * token (a row in `SYMBOL_NAMES`; `{foo}` is not one):
 *
 * - a JSX child of an INTRINSIC element (`<p>Pay {"{2}"}</p>`,
 *   `<button>Companion {"{3}"}</button>`): raw DOM text no parser touches.
 *   The fix is `withSymbols("…")`, or a primitive.
 * - a plain-text attribute (`title`, `aria-label`, `placeholder`, `alt`,
 *   `aria-description`) on ANY element: it cannot hold an icon, so the copy
 *   says the spoken name, or runs dynamic text through
 *   `symbolsToSpokenText`.
 *
 * A literal passed as an argument to a call (`withSymbols("Pay {G}")`,
 * `symbolsToSpokenText(…)`) is not a JSX child, so it is never a hit.
 * Comments are not literals. What a static scan cannot see — an engine string
 * reaching raw DOM — is the `check:ui` `rawSymbolTokens` Floor's.
 */

const PLAIN_TEXT_ATTRIBUTES = new Set([
    "title",
    "aria-label",
    "aria-description",
    "placeholder",
    "alt",
]);

export interface UiSymbolLiteralHit {
    /** Repo-relative path, forward-slash separated. */
    file: string;
    /** 1-based line number. */
    line: number;
    /** Which bypass: a raw-DOM child, or a plain-text attribute. */
    kind: "dom-text" | "attribute";
    /** The literal, as written. */
    text: string;
}

function walk(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (
            entry.name.endsWith(".tsx") &&
            !entry.name.endsWith(".test.tsx")
        ) {
            out.push(full);
        }
    }
}

function hasMappableToken(text: string): boolean {
    for (const m of text.matchAll(BRACE_TOKEN_RE)) {
        if (symbolName(m[1]) !== undefined) return true;
    }
    return false;
}

/** The literal text of a string or template literal (template spans are
 *  read as their raw head/tail pieces), `undefined` for any other node. */
function literalText(node: ts.Node | undefined): string | undefined {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }
    if (ts.isTemplateExpression(node)) {
        return [
            node.head.text,
            ...node.templateSpans.map((s) => s.literal.text),
        ].join("");
    }
    return undefined;
}

function isIntrinsic(tag: ts.JsxTagNameExpression): boolean {
    return ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
}

/** Scan one `.tsx` source text; exported for the guard's own fixtures. */
export function scanUiSymbolLiteralSource(
    file: string,
    source: string
): UiSymbolLiteralHit[] {
    const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
    );
    const hits: UiSymbolLiteralHit[] = [];
    const push = (
        node: ts.Node,
        kind: UiSymbolLiteralHit["kind"],
        text: string
    ) =>
        hits.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            kind,
            text,
        });
    const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) && isIntrinsic(node.openingElement.tagName)) {
            for (const child of node.children) {
                if (!ts.isJsxExpression(child)) continue;
                const text = literalText(child.expression);
                if (text !== undefined && hasMappableToken(text)) {
                    push(child, "dom-text", text);
                }
            }
        }
        if (ts.isJsxAttribute(node)) {
            const name = node.name.getText(sf);
            if (PLAIN_TEXT_ATTRIBUTES.has(name) && node.initializer) {
                const init = node.initializer;
                const text = ts.isStringLiteral(init)
                    ? init.text
                    : ts.isJsxExpression(init)
                      ? literalText(init.expression)
                      : undefined;
                if (text !== undefined && hasMappableToken(text)) {
                    push(node, "attribute", text);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return hits;
}

/** Scan `src/**\/*.tsx` (production code only — tests and `__tests__` are
 *  excluded: a fixture spells a token on purpose). */
export function scanUiSymbolLiterals(repoRoot: string): UiSymbolLiteralHit[] {
    const files: string[] = [];
    walk(path.join(repoRoot, "src"), files);
    return files.flatMap((full) =>
        scanUiSymbolLiteralSource(
            path.relative(repoRoot, full).split(path.sep).join("/"),
            fs.readFileSync(full, "utf8")
        )
    );
}
