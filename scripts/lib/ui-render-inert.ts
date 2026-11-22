/**
 * Can a module's CHANGED HUNKS reach rendering (issue #10393)?
 *
 * WHY. `check:ui`'s two decisions — does the diff owe a walk
 * (`uiWalkOwed`), which surfaces does it select (`computeUiScope`) — judged a
 * changed module by its NAME and its import closure: one line in an event
 * handler of a file named `*dialog*` owed a walk of every surface the file's
 * route reaches, though no pixel could move. This module reads what the
 * changed lines ARE, on the TypeScript AST, so a file whose every changed line
 * sits in a render-inert construct contributes nothing to either decision.
 *
 * FAIL-CLOSED, like the rest of the scoper: a changed line is render-inert
 * only when it is AFFIRMATIVELY placed in one of the constructs below; any
 * other line — a component or hook body, JSX, a returned expression, a
 * constant render reads, module top level — reaches rendering, and so does an
 * unparsable file, a new file (no base side) or a line the AST cannot map.
 * Both sides are read: removed lines on the base source, added lines on the
 * head source, each against its own AST.
 *
 * A changed line is render-inert when every token on it is:
 *   - NONE AT ALL — a blank or comment-only line;
 *   - inside an EVENT HANDLER's body, and the innermost statement holding the
 *     token names no render-reaching verb (`RENDER_REACHING`: a state setter,
 *     a reducer dispatch, a navigation, a class or style, the DOM). A handler
 *     is a function whose body holds no JSX and that is
 *       · the arrow / function written directly as an `on[A-Z]…` JSX prop, or
 *       · a non-exported `const`/`function` binding (optionally wrapped in
 *         `useCallback`) whose every reference is the value of an `on[A-Z]…`
 *         JSX prop or sits inside another handler's body — so nothing calls
 *         it during render, and nothing hands it to code that might;
 *   - inside a value `import` of a JS module (no side-effect-only import, no
 *     stylesheet or asset specifier) whose every binding is referenced only
 *     inside handler bodies, or not at all — so swapping or dropping it
 *     changes what a handler calls, never what renders. `import type`
 *     counts too: the build erases it.
 *
 * Which `on*` props count: on an intrinsic element, only the DOM events user
 * input fires (`USER_INPUT_EVENT`) — `onLoad`, `onError`, `onAnimationEnd`
 * and kin fire at rest; on a custom component, any `on*` callback not named
 * for a lifecycle or at-rest event (`AT_REST_CALLBACK`).
 *
 * ACCEPTED RESIDUALS, recorded rather than closed (the issue's scope):
 *   - a custom component that calls a user-action-named callback
 *     (`onSwitchGame`) from an effect, at rest: the name is the only signal
 *     this module reads;
 *   - only the CHANGED lines of a handler are read: an unchanged
 *     `setX(value)` below a changed line that computes `value` is not seen —
 *     the walk measures layout at rest, and never runs an event handler that
 *     no opener drives (an opener's handler sets state, which this refuses);
 *   - a module first imported (or last un-imported) by a handler-only import
 *     line has its top-level side effects added (or dropped) at load.
 *
 * BOOT FILES (`src/main.tsx`, `vite.config.ts`, issue #10616) are read under a
 * RESTRICTED rule set instead: trivia, a token inside a boot-configuration
 * region (`ui-boot-config-regions.ts`: the `Sentry.init` options, the
 * dev-server proxy table) and an import only those regions read. No handler
 * rule applies there.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as ts from "typescript";
import { ORIGIN_BASE } from "./branches.ts";
import { zeroContextLines } from "./ui-stylesheet-scope.ts";
import {
    bootConfigScan,
    isBootConfigFile,
    type BootConfigScan,
} from "./ui-boot-config-regions.ts";

/** A changed module's two sides and the 1-based line numbers its diff
 *  removes (on `before`) and adds (on `after`). */
export interface ModuleHunks {
    before: string;
    after: string;
    removed: readonly number[];
    added: readonly number[];
}

export type RenderInert =
    | { inert: true; reason: string }
    | { inert: false; at: string };

/** The verbs a handler line may not name: each can move pixels when the
 *  handler runs (state, routing, class or style, the DOM, the viewport). */
const RENDER_REACHING =
    /\bset[A-Z]\w*\s*\(|\bdispatch\s*\(|\bnavigate\b|\bclassName\b|\bclassList\b|\bstyle\b|\bdocument\b|\bwindow\b|\blocation\b|\bhistory\b|\bzIndex\b|\bmatchMedia\b|\bcreatePortal\b|\bscroll\w*|\bfocus\s*\(/;

/** A specifier that names a stylesheet, an asset or a query-suffixed import
 *  (`?url`, `?raw`): never a plain JS module. */
const NON_MODULE_SPECIFIER =
    /\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|json|html)$|\?/;

const HANDLER_PROP = /^on[A-Z]/;

/** On an intrinsic element (`<button>`, `<img>`), the DOM events only USER
 *  INPUT fires. `onLoad`, `onError`, `onAnimationEnd`, `onTransitionEnd`,
 *  `onFocus` (autofocus), `onScroll`… fire while the page sits at rest, so
 *  their bodies run under the walk and stay owed. */
const USER_INPUT_EVENT =
    /^on(?:Click|DoubleClick|ContextMenu|Pointer(?:Down|Up|Cancel)|Mouse(?:Down|Up)|Key(?:Down|Up|Press)|Change|Input|BeforeInput|Submit|Reset|Drag\w*|Drop|Touch(?:Start|End|Cancel)|Wheel|Copy|Cut|Paste)(?:Capture)?$/;

/** On a custom component, an `on*` prop is a callback the component decides
 *  when to call. One named for a lifecycle or at-rest event (`onReady`,
 *  `onImageLoaded`, `onMount`, `onAnimationEnd`, `onVisible`…) is likely
 *  called from an effect, so its body runs at rest: stays owed. */
const AT_REST_CALLBACK =
    /Load|Error|Ready|Mount|Init|Render|Animation|Transition|Focus|Blur|Resize|Scroll|Measure|Layout|Visib|Intersect|Settle|Complete|Hydrat|Update|Change|Start|End|Success|Fail|Timeout|Tick|Frame|Idle/;

type FunctionLike =
    | ts.ArrowFunction
    | ts.FunctionExpression
    | ts.FunctionDeclaration;

interface Region {
    start: number;
    end: number;
    label: string;
}

interface SideVerdict {
    /** The first line that reaches rendering, as `<line>: <construct>`. */
    reaching: string | null;
    /** What placed the inert lines, deduplicated. */
    placements: Set<string>;
}

function isFunctionLike(node: ts.Node): node is FunctionLike {
    return (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node)
    );
}

function isExported(node: ts.Node): boolean {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return (
        mods?.some(
            (m) =>
                m.kind === ts.SyntaxKind.ExportKeyword ||
                m.kind === ts.SyntaxKind.DefaultKeyword
        ) ?? false
    );
}

function containsJsx(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
        if (found) return;
        if (
            ts.isJsxElement(n) ||
            ts.isJsxSelfClosingElement(n) ||
            ts.isJsxFragment(n)
        ) {
            found = true;
            return;
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
}

/** Is `node` the value of an `on[A-Z]…` JSX attribute (`onClick={node}`)? */
function isHandlerPropValue(node: ts.Node): boolean {
    const expr = node.parent;
    if (!expr || !ts.isJsxExpression(expr)) return false;
    const attr = expr.parent;
    if (
        !attr ||
        !ts.isJsxAttribute(attr) ||
        !ts.isIdentifier(attr.name) ||
        !HANDLER_PROP.test(attr.name.text)
    ) {
        return false;
    }
    const prop = attr.name.text;
    const element = attr.parent.parent; // JsxAttributes → opening element
    const tag = element.tagName;
    const intrinsic = ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
    return intrinsic
        ? USER_INPUT_EVENT.test(prop)
        : !AT_REST_CALLBACK.test(prop.slice(2));
}

/** The binding a function is declared under, when it is a non-exported
 *  `const name = fn`, `const name = useCallback(fn, …)` or
 *  `function name() {}`; `null` otherwise. */
function bindingOf(fn: FunctionLike): ts.Identifier | null {
    if (ts.isFunctionDeclaration(fn)) {
        return fn.name && !isExported(fn) ? fn.name : null;
    }
    let holder: ts.Node = fn.parent;
    if (
        ts.isCallExpression(holder) &&
        ts.isIdentifier(holder.expression) &&
        holder.expression.text === "useCallback" &&
        holder.arguments[0] === fn
    ) {
        holder = holder.parent;
    }
    if (!ts.isVariableDeclaration(holder) || !ts.isIdentifier(holder.name)) {
        return null;
    }
    const list = holder.parent;
    if (
        !ts.isVariableDeclarationList(list) ||
        (list.flags & ts.NodeFlags.Const) === 0
    ) {
        return null;
    }
    const statement = list.parent;
    if (ts.isVariableStatement(statement) && isExported(statement)) return null;
    return holder.name;
}

/** Is this identifier a READ of a binding — not a property name, a key, a
 *  JSX attribute name or the name some declaration introduces? */
function isReference(id: ts.Identifier): boolean {
    const p = id.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    if (ts.isQualifiedName(p) && p.right === id) return false;
    if (ts.isJsxAttribute(p) && p.name === id) return false;
    if (
        (ts.isPropertyAssignment(p) ||
            ts.isPropertyDeclaration(p) ||
            ts.isPropertySignature(p) ||
            ts.isMethodDeclaration(p) ||
            ts.isMethodSignature(p) ||
            ts.isVariableDeclaration(p) ||
            ts.isParameter(p) ||
            ts.isFunctionDeclaration(p) ||
            ts.isFunctionExpression(p) ||
            ts.isClassDeclaration(p) ||
            ts.isTypeAliasDeclaration(p) ||
            ts.isInterfaceDeclaration(p) ||
            ts.isEnumDeclaration(p) ||
            ts.isImportSpecifier(p) ||
            ts.isImportClause(p) ||
            ts.isNamespaceImport(p)) &&
        (p as { name?: ts.Node }).name === id
    ) {
        return false;
    }
    if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) {
        return false;
    }
    if (ts.isImportSpecifier(p) && p.propertyName === id) return false;
    return true;
}

/** One side's ASTs, regions and verdict. */
function judgeSide(
    sf: ts.SourceFile | null,
    lines: readonly number[],
    otherSide: ReadonlySet<string>,
    path: string
): SideVerdict {
    const placements = new Set<string>();
    if (lines.length === 0) return { reaching: null, placements };
    if (sf === null) {
        return {
            reaching: `${lines[0]}: unparsable module (a syntax error the AST cannot place)`,
            placements,
        };
    }
    const source = sf.text;
    // A boot file (issue #10616): only its boot-configuration regions, its
    // trivia and the imports only those regions read can be inert.
    const boot: BootConfigScan | null = bootConfigScan(path, sf);

    // Every identifier, once: the reference scan below reads it per binding.
    const identifiers: ts.Identifier[] = [];
    const functions: FunctionLike[] = [];
    const imports: ts.ImportDeclaration[] = [];
    const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n)) identifiers.push(n);
        if (isFunctionLike(n) && n.body) functions.push(n);
        if (ts.isImportDeclaration(n)) imports.push(n);
        ts.forEachChild(n, visit);
    };
    visit(sf);
    const referencesTo = (decl: ts.Identifier): ts.Identifier[] =>
        identifiers.filter(
            (id) => id !== decl && id.text === decl.text && isReference(id)
        );

    // Handler candidates, then the fixpoint: drop every named candidate with
    // a reference outside an `on*` prop value and outside the surviving
    // handlers' bodies, until nothing more drops.
    interface Candidate {
        fn: FunctionLike;
        body: ts.Node;
        label: string;
        refs: ts.Identifier[] | null; // null: inline `on*` prop value
    }
    let handlers: Candidate[] = [];
    for (const fn of boot === null ? functions : []) {
        const body = fn.body as ts.Node;
        if (containsJsx(body)) continue;
        if (isHandlerPropValue(fn)) {
            const attr = fn.parent.parent as ts.JsxAttribute;
            handlers.push({
                fn,
                body,
                label: `an inline ${(attr.name as ts.Identifier).text} handler`,
                refs: null,
            });
            continue;
        }
        const name = bindingOf(fn);
        if (name === null) continue;
        handlers.push({
            fn,
            body,
            label: `the ${name.text} handler`,
            refs: referencesTo(name),
        });
    }
    const inside = (node: ts.Node, outer: ts.Node): boolean =>
        node.getStart(sf) >= outer.getStart(sf) &&
        node.getEnd() <= outer.getEnd();
    for (;;) {
        const kept = handlers.filter(
            (h) =>
                h.refs === null ||
                h.refs.every(
                    (r) =>
                        isHandlerPropValue(r) ||
                        handlers.some((o) => inside(r, o.body))
                )
        );
        if (kept.length === handlers.length) break;
        handlers = kept;
    }
    const inHandler = (node: ts.Node): Candidate | undefined =>
        handlers.find((h) => inside(node, h.body));
    const inBoot = (node: ts.Node) =>
        boot?.regions.find(
            (r) => node.getStart(sf) >= r.start && node.getEnd() <= r.end
        );

    const importRegions: Region[] = [];
    for (const decl of imports) {
        const clause = decl.importClause;
        if (!clause) continue; // side-effect-only: runs its module
        const spec = (decl.moduleSpecifier as ts.StringLiteral).text;
        const label =
            boot === null
                ? `an import from ${spec} whose changed bindings only handlers read`
                : `an import from ${spec} whose changed bindings only boot configuration reads`;
        if (clause.isTypeOnly) {
            importRegions.push({
                start: decl.getStart(sf),
                end: decl.getEnd(),
                label: `a type-only import from ${spec}`,
            });
            continue;
        }
        if (NON_MODULE_SPECIFIER.test(spec)) continue;
        // A binding the other side imports identically (same module, same
        // imported name, same local name) means the same thing on both
        // sides, wherever render reads it: only the bindings this side alone
        // has must be handler-only.
        const handlerOnly = valueBindings(decl)
            .filter((b) => !otherSide.has(b.identity))
            .every((b) =>
                referencesTo(b.local).every(
                    (r) => inHandler(r) !== undefined || inBoot(r) !== undefined
                )
            );
        if (handlerOnly) {
            importRegions.push({
                start: decl.getStart(sf),
                end: decl.getEnd(),
                label,
            });
        }
    }

    // Leaf tokens, comments excluded: a line holding none is trivia.
    const tokens: ts.Node[] = [];
    const collect = (n: ts.Node): void => {
        if (
            n.kind >= ts.SyntaxKind.FirstJSDocNode &&
            n.kind <= ts.SyntaxKind.LastJSDocNode
        ) {
            return;
        }
        const kids = n.getChildren(sf);
        if (kids.length === 0) {
            if (n.kind !== ts.SyntaxKind.EndOfFileToken && n.getWidth(sf) > 0) {
                tokens.push(n);
            }
            return;
        }
        for (const k of kids) collect(k);
    };
    collect(sf);

    const lineCount = sf.getLineStarts().length;
    for (const line of [...lines].sort((a, b) => a - b)) {
        if (line < 1 || line > lineCount) {
            return {
                reaching: `${line}: a changed line outside the module (diff and source disagree)`,
                placements,
            };
        }
        const start = sf.getPositionOfLineAndCharacter(line - 1, 0);
        const end =
            line < lineCount
                ? sf.getPositionOfLineAndCharacter(line, 0)
                : source.length;
        // Tokens come in document order and never overlap, so their ends
        // ascend too: binary-search the first token ending past the line's
        // start, then take tokens until one starts past its end.
        let lo = 0;
        let hi = tokens.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (tokens[mid].getEnd() > start) hi = mid;
            else lo = mid + 1;
        }
        const onLine: ts.Node[] = [];
        for (
            let k = lo;
            k < tokens.length && tokens[k].getStart(sf) < end;
            k++
        ) {
            onLine.push(tokens[k]);
        }
        if (onLine.length === 0) {
            placements.add("comments / blank lines");
            continue;
        }
        for (const token of onLine) {
            const at = token.getStart(sf);
            const region = importRegions.find(
                (r) => at >= r.start && token.getEnd() <= r.end
            );
            if (region) {
                placements.add(region.label);
                continue;
            }
            const bootRegion = inBoot(token);
            if (bootRegion && boot) {
                if (boot.refuse.test.test(source.slice(start, end))) {
                    return {
                        reaching: `${line}: ${boot.refuse.why}`,
                        placements,
                    };
                }
                placements.add(bootRegion.label);
                continue;
            }
            const handler = inHandler(token);
            if (handler) {
                const text = innermostStatementText(token, handler.body, sf);
                if (RENDER_REACHING.test(text)) {
                    return {
                        reaching: `${line}: a line of ${handler.label} that sets state, dispatches, navigates or touches class / style / DOM`,
                        placements,
                    };
                }
                placements.add(`${handler.label}'s body`);
                continue;
            }
            return {
                reaching: `${line}: ${constructOf(token, sf)}`,
                placements,
            };
        }
    }
    return { reaching: null, placements };
}

/** The innermost statement (not a bare block) holding `token` inside
 *  `body` — or the whole expression body of an arrow. */
function innermostStatementText(
    token: ts.Node,
    body: ts.Node,
    sf: ts.SourceFile
): string {
    for (let n: ts.Node = token; n !== body; n = n.parent) {
        if (ts.isStatement(n) && !ts.isBlock(n)) return n.getText(sf);
    }
    return body.getText(sf);
}

/** What a render-reaching token sits in, named for the `--scope-only` audit. */
function constructOf(token: ts.Node, sf: ts.SourceFile): string {
    let fn: FunctionLike | null = null;
    for (let n: ts.Node = token.parent; n !== sf; n = n.parent) {
        if (
            ts.isJsxElement(n) ||
            ts.isJsxSelfClosingElement(n) ||
            ts.isJsxFragment(n)
        ) {
            return "JSX";
        }
        if (ts.isImportDeclaration(n)) {
            return n.importClause
                ? "an import whose binding is read outside an event handler"
                : "a side-effect import";
        }
        if (fn === null && isFunctionLike(n)) fn = n;
    }
    if (fn === null) return "module top level";
    const name = bindingOf(fn)?.text ?? fn.name?.getText(sf);
    return name
        ? `the body of ${name} (a component, hook or helper render can reach)`
        : "a function body render can reach";
}

/** The module's AST, or `null` when it does not parse cleanly. */
function parseModule(path: string, source: string): ts.SourceFile | null {
    const sf = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const diagnostics = (sf as unknown as { parseDiagnostics?: unknown[] })
        .parseDiagnostics;
    return diagnostics !== undefined && diagnostics.length === 0 ? sf : null;
}

interface ValueBinding {
    local: ts.Identifier;
    /** `<specifier>|<imported name>|<local name>`: equal on both sides =
     *  the same binding. */
    identity: string;
}

/** The value (non-type) bindings an import declaration introduces. */
function valueBindings(decl: ts.ImportDeclaration): ValueBinding[] {
    const clause = decl.importClause;
    if (!clause || clause.isTypeOnly) return [];
    const spec = (decl.moduleSpecifier as ts.StringLiteral).text;
    const out: ValueBinding[] = [];
    const add = (imported: string, local: ts.Identifier) =>
        out.push({ local, identity: `${spec}|${imported}|${local.text}` });
    if (clause.name) add("default", clause.name);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) add("*", named.name);
    if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
            if (!el.isTypeOnly) add((el.propertyName ?? el.name).text, el.name);
        }
    }
    return out;
}

/** Every value-binding identity a module imports (empty when unparsable). */
function importIdentities(sf: ts.SourceFile | null): Set<string> {
    const ids = new Set<string>();
    if (sf === null) return ids;
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st)) continue;
        for (const b of valueBindings(st)) ids.add(b.identity);
    }
    return ids;
}

/** The verdict for one changed module: render-inert only when every changed
 *  line on both sides is. */
export function classifyRenderInert(
    path: string,
    hunks: ModuleHunks
): RenderInert {
    if (hunks.removed.length === 0 && hunks.added.length === 0) {
        return { inert: false, at: `${path}: no changed line to place` };
    }
    const before = parseModule(path, hunks.before);
    const after = parseModule(path, hunks.after);
    const base = judgeSide(
        before,
        hunks.removed,
        importIdentities(after),
        path
    );
    if (base.reaching !== null) {
        return { inert: false, at: `${path}:${base.reaching} (base side)` };
    }
    const head = judgeSide(after, hunks.added, importIdentities(before), path);
    if (head.reaching !== null) {
        return { inert: false, at: `${path}:${head.reaching}` };
    }
    const placed = [...new Set([...base.placements, ...head.placements])];
    return { inert: true, reason: placed.join("; ") };
}

/** A path this classifier may clear: a `src/**` TS module that is not a
 *  global styling input (the routers, the design tokens and the catalogue
 *  gate stay owed by their path — `globalReason`), or a boot file, read under
 *  the restricted rule set (issue #10616). */
export function isRenderInertCandidate(path: string): boolean {
    if (isBootConfigFile(path)) return true;
    return (
        /^src\/.+\.tsx?$/.test(path) &&
        !path.endsWith(".d.ts") &&
        ![
            "src/app-router.tsx",
            "src/router.tsx",
            "src/lib/design-tokens.ts",
            "src/components/ui/catalogue-gate.tsx",
        ].includes(path)
    );
}

/** `classifyRenderInert` for each candidate of `changed`, against its diff
 *  from `base`'s merge-base to the working tree at `root`. A path that cannot
 *  be read — no merge-base, a new or deleted file, a git error — is absent
 *  from the map: the caller treats it as reaching rendering (fail closed). */
export function renderInertSinceBase(
    changed: readonly string[],
    root: string,
    base: string = ORIGIN_BASE
): Map<string, RenderInert> {
    const verdicts = new Map<string, RenderInert>();
    const candidates = changed.filter(isRenderInertCandidate);
    if (candidates.length === 0) return verdicts;
    const git = (args: string[]): string =>
        execFileSync("git", args, {
            cwd: root,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            stdio: ["ignore", "pipe", "ignore"],
        });
    let mergeBase: string;
    try {
        mergeBase = git(["merge-base", base, "HEAD"]).trim();
    } catch {
        return verdicts;
    }
    for (const file of candidates) {
        try {
            const abs = nodePath.join(root, file);
            if (!fs.existsSync(abs)) continue;
            const before = git(["show", `${mergeBase}:${file}`]);
            const after = fs.readFileSync(abs, "utf8");
            const diff = git([
                "diff",
                "-U0",
                "--no-color",
                "--no-ext-diff",
                mergeBase,
                "--",
                file,
            ]);
            if (diff === "") continue;
            verdicts.set(
                file,
                classifyRenderInert(file, {
                    before,
                    after,
                    ...zeroContextLines(diff),
                })
            );
        } catch {
            // Unreadable (a new file has no base side): stays owed.
        }
    }
    return verdicts;
}
