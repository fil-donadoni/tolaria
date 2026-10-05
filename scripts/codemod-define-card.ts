#!/usr/bin/env bun
/**
 * `bun scripts/codemod-define-card.ts [--check]` — the migrate step of PRD
 * #4849 (issue #4859): every hand-written Card Definition export in a Set
 * module becomes `defineCard(() => ({ … }))`, and every use of such an export
 * as a value (tests, scripts, other Set modules, spreads, cross-set
 * references) becomes a call (`X` → `X()`).
 *
 * Idempotent: a declaration already shaped `defineCard(…)` is not rewritten,
 * a reference already called is not called again, so a second run — e.g. to
 * resolve a rebase conflict by re-running it on the rebased tree — prints
 * `0 edits`. `--check` writes nothing and exits 1 when the tree still owes an
 * edit.
 *
 * Method: one TypeScript program over every tracked `.ts`/`.tsx` file, the
 * checker resolves each identifier (through imports, `export *` barrels,
 * aliases, namespace members) to its declaration; text edits are applied
 * back to front. Formatting is left to `bun run format`.
 *
 * Uses that cannot be mechanically called (`typeof X`, a reference inside a
 * type position) are listed and the run exits 2 without writing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const SET_MODULE_RE = /^convex\/cards\/sets\/.+\.cards\.ts$/;
const FACTORY = "defineCard";
const TYPE_NAME = "CardDefinition";

/** Tests of `defineCard` itself: they hold a Set export AS a factory (read its
 *  brand, count its builds), so a reference there is never a use to call. */
const FACTORY_AS_VALUE_FILES = new Set([
    "convex/cards/__tests__/defineCard.test.ts",
    "convex/__tests__/defineCardFullPath.test.ts",
]);

interface Edit {
    pos: number;
    end: number;
    text: string;
    /** Tie-break at one position: the higher `closes` is applied first, so
     *  it ends up AFTER an insertion made at the same point. */
    closes?: number;
}

function trackedSources(): string[] {
    const out = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    return out
        .split("\n")
        .filter(Boolean)
        .filter((f) => !f.endsWith(".d.ts"))
        .map((f) => join(ROOT, f));
}

function rel(file: string): string {
    return relative(ROOT, file);
}

function isFactoryCall(node: ts.Expression | undefined): boolean {
    return (
        node !== undefined &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === FACTORY
    );
}

/** An exported hand-written definition of a Set module, in either shape. */
function declarationKind(
    decl: ts.Declaration | undefined,
    file: string
): "eager" | "factory" | undefined {
    if (decl === undefined || !ts.isVariableDeclaration(decl)) return undefined;
    if (!SET_MODULE_RE.test(rel(file))) return undefined;
    const list = decl.parent;
    const stmt = list.parent;
    if (!ts.isVariableStatement(stmt)) return undefined;
    if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
        return undefined;
    if (isFactoryCall(decl.initializer)) return "factory";
    if (
        decl.type !== undefined &&
        ts.isTypeReferenceNode(decl.type) &&
        decl.type.typeName.getText() === TYPE_NAME &&
        decl.initializer !== undefined
    )
        return "eager";
    return undefined;
}

function resolveSymbol(
    checker: ts.TypeChecker,
    id: ts.Identifier
): ts.Symbol | undefined {
    let sym: ts.Symbol | undefined;
    if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) {
        sym = checker.getShorthandAssignmentValueSymbol(id.parent);
    } else {
        sym = checker.getSymbolAtLocation(id);
    }
    if (sym !== undefined && sym.flags & ts.SymbolFlags.Alias) {
        sym = checker.getAliasedSymbol(sym);
    }
    return sym;
}

function main(): void {
    const checkOnly = process.argv.includes("--check");
    const files = trackedSources();
    const program = ts.createProgram(files, {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowImportingTsExtensions: true,
        allowJs: false,
        jsx: ts.JsxEmit.ReactJSX,
        skipLibCheck: true,
        noEmit: true,
        types: ["node"],
        baseUrl: ROOT,
        paths: {
            "~/*": ["./src/*"],
            "@/*": ["./src/*"],
            "@convex/*": ["./convex/*"],
        },
    });
    const checker = program.getTypeChecker();

    // 1. Names of every migrated / migratable export.
    const names = new Set<string>();
    const declTargets = new Map<string, ts.VariableDeclaration[]>();
    for (const sf of program.getSourceFiles()) {
        if (!SET_MODULE_RE.test(rel(sf.fileName))) continue;
        for (const stmt of sf.statements) {
            if (!ts.isVariableStatement(stmt)) continue;
            for (const d of stmt.declarationList.declarations) {
                if (declarationKind(d, sf.fileName) === undefined) continue;
                names.add(d.name.getText());
                if (declarationKind(d, sf.fileName) === "eager") {
                    const list = declTargets.get(sf.fileName) ?? [];
                    list.push(d);
                    declTargets.set(sf.fileName, list);
                }
            }
        }
    }

    const edits = new Map<string, Edit[]>();
    const manual: string[] = [];
    const add = (file: string, e: Edit): void => {
        const list = edits.get(file) ?? [];
        list.push(e);
        edits.set(file, list);
    };

    // 2. Declarations.
    for (const [file, decls] of declTargets) {
        const sf = program.getSourceFile(file);
        if (sf === undefined) continue;
        for (const d of decls) {
            const init = d.initializer as ts.Expression;
            // Two edits, not one replacement: a reference inside the
            // initializer is its own edit and must survive.
            add(file, {
                pos: d.name.end,
                end: init.getStart(sf),
                text: ` = ${FACTORY}(() => (`,
            });
            add(file, { pos: init.end, end: init.end, text: "))", closes: 1 });
        }
    }

    // 3. References.
    for (const sf of program.getSourceFiles()) {
        if (sf.isDeclarationFile) continue;
        if (!files.includes(sf.fileName)) continue;
        if (FACTORY_AS_VALUE_FILES.has(rel(sf.fileName))) continue;
        const local = new Set(names);
        sf.forEachChild(function findAliases(n) {
            if (
                ts.isImportSpecifier(n) &&
                n.propertyName !== undefined &&
                names.has(n.propertyName.text)
            ) {
                local.add(n.name.text);
            }
            n.forEachChild(findAliases);
        });
        const visit = (n: ts.Node): void => {
            if (ts.isIdentifier(n) && local.has(n.text)) handle(sf, n);
            n.forEachChild(visit);
        };
        visit(sf);
    }

    function handle(sf: ts.SourceFile, id: ts.Identifier): void {
        const parent = id.parent;
        if (
            ts.isImportSpecifier(parent) ||
            ts.isExportSpecifier(parent) ||
            ts.isImportClause(parent) ||
            ts.isNamespaceImport(parent)
        )
            return;
        if (ts.isVariableDeclaration(parent) && parent.name === id) return;
        if (
            (ts.isPropertyAssignment(parent) && parent.name === id) ||
            (ts.isPropertyDeclaration(parent) && parent.name === id) ||
            (ts.isMethodDeclaration(parent) && parent.name === id) ||
            (ts.isPropertySignature(parent) && parent.name === id) ||
            (ts.isBindingElement(parent) && parent.propertyName === id)
        ) {
            return;
        }
        const sym = resolveSymbol(checker, id);
        const decl = sym?.valueDeclaration;
        if (decl === undefined) return;
        const kind = declarationKind(decl, decl.getSourceFile().fileName);
        if (kind === undefined) return;
        // The declaration's own name is not a use.
        if (ts.isVariableDeclaration(decl) && decl.name === id) return;

        // Already called?
        let top: ts.Node = id;
        if (ts.isPropertyAccessExpression(parent) && parent.name === id) {
            top = parent;
        }
        const up = top.parent;
        if (ts.isCallExpression(up) && up.expression === top) return;

        const where = `${rel(sf.fileName)}:${
            sf.getLineAndCharacterOfPosition(id.getStart()).line + 1
        }`;
        const query = typeQueryOf(id);
        if (query !== undefined) {
            // `typeof X` was the definition's type; now X is its factory.
            if (
                ts.isTypeReferenceNode(query.parent) &&
                query.parent.typeName.getText() === "ReturnType"
            )
                return;
            const path: string[] = [];
            let name: ts.EntityName = query.exprName;
            while (ts.isQualifiedName(name)) {
                path.unshift(name.right.text);
                name = name.left;
            }
            add(sf.fileName, {
                pos: query.getStart(),
                end: query.end,
                text:
                    `ReturnType<typeof ${id.text}>` +
                    path.map((p) => `[${JSON.stringify(p)}]`).join(""),
            });
            return;
        }
        if (isInTypePosition(id)) {
            manual.push(`${where}  type position: ${parent.getText(sf)}`);
            return;
        }
        if (ts.isShorthandPropertyAssignment(parent)) {
            add(sf.fileName, {
                pos: id.getStart(),
                end: id.end,
                text: `${id.text}: ${id.text}()`,
            });
            return;
        }
        add(sf.fileName, { pos: top.end, end: top.end, text: "()" });
    }

    function typeQueryOf(id: ts.Identifier): ts.TypeQueryNode | undefined {
        let n: ts.Node = id;
        while (ts.isQualifiedName(n.parent)) n = n.parent;
        return ts.isTypeQueryNode(n.parent) ? n.parent : undefined;
    }

    function isInTypePosition(id: ts.Identifier): boolean {
        for (let n: ts.Node = id; n.parent !== undefined; n = n.parent) {
            if (ts.isTypeNode(n.parent) || ts.isTypeQueryNode(n.parent))
                return true;
            if (ts.isStatement(n.parent)) return false;
        }
        return false;
    }

    if (manual.length > 0) {
        console.error(`codemod: ${manual.length} use(s) need a human:`);
        for (const m of manual) console.error(`  ${m}`);
        process.exit(2);
    }

    // 4. Imports: `defineCard` in, `CardDefinition` out when now unused.
    for (const file of declTargets.keys()) {
        const sf = program.getSourceFile(file);
        if (sf === undefined) continue;
        importEdits(sf).forEach((e) => add(file, e));
    }

    function importEdits(sf: ts.SourceFile): Edit[] {
        const out: Edit[] = [];
        const typesImports = sf.statements.filter(
            (s): s is ts.ImportDeclaration =>
                ts.isImportDeclaration(s) &&
                ts.isStringLiteral(s.moduleSpecifier) &&
                /(^|\/)cards\/types$|^(\.\.\/)+types$/.test(
                    s.moduleSpecifier.text
                )
        );
        // Is `CardDefinition` still referenced once the declarations are gone?
        const declared = new Set(
            (declTargets.get(sf.fileName) ?? []).map((d) => d.type)
        );
        let stillUsed = false;
        const scan = (n: ts.Node): void => {
            if (ts.isImportDeclaration(n)) return;
            if (declared.has(n as ts.TypeNode)) return;
            if (ts.isIdentifier(n) && n.text === TYPE_NAME) stillUsed = true;
            n.forEachChild(scan);
        };
        scan(sf);

        const named = (
            i: ts.ImportDeclaration
        ): ts.NamedImports | undefined => {
            const nb = i.importClause?.namedBindings;
            return nb !== undefined && ts.isNamedImports(nb) ? nb : undefined;
        };
        const withNames = typesImports.filter((i) => named(i) !== undefined);
        // The import `defineCard` joins: a value import when there is one, so
        // no second statement from the same module appears.
        const target =
            withNames.find((i) => !i.importClause?.isTypeOnly) ?? withNames[0];
        const hasFactory = withNames.some((i) =>
            named(i)!.elements.some(
                (el) => el.name.text === FACTORY && !el.isTypeOnly
            )
        );
        if (target === undefined) {
            // No import of the types module with named bindings: a new one.
            const spec = relativeTypesSpecifier(sf.fileName);
            const first = sf.statements.find(ts.isImportDeclaration);
            const at = first?.getStart() ?? 0;
            out.push({
                pos: at,
                end: at,
                text: `import { ${FACTORY} } from "${spec}";\n`,
            });
            return out;
        }
        for (const decl of withNames) {
            const typeOnlyDecl = decl.importClause!.isTypeOnly;
            const kept = named(decl)!.elements.filter(
                (el) => stillUsed || el.name.text !== TYPE_NAME
            );
            const parts = kept.map((el) => {
                const t = el.getText(sf);
                return typeOnlyDecl && !el.isTypeOnly && decl === target
                    ? `type ${t}`
                    : t;
            });
            const gains = decl === target && !hasFactory;
            if (gains) parts.unshift(FACTORY);
            if (!gains && kept.length === named(decl)!.elements.length)
                continue;
            if (parts.length === 0) {
                // The statement held only `CardDefinition`: drop it, line and all.
                const next =
                    sf.text[decl.end] === "\n" ? decl.end + 1 : decl.end;
                out.push({ pos: decl.getStart(), end: next, text: "" });
                continue;
            }
            // A type-only statement that gains a value specifier stops being one.
            const head =
                gains && typeOnlyDecl
                    ? "import"
                    : decl.importClause!.isTypeOnly
                      ? "import type"
                      : "import";
            out.push({
                pos: decl.getStart(),
                end: decl.end,
                text: `${head} { ${parts.join(", ")} } from ${decl.moduleSpecifier.getText(sf)};`,
            });
        }
        return out;
    }

    function relativeTypesSpecifier(file: string): string {
        let r = relative(dirname(file), join(ROOT, "convex/cards/types"));
        if (!r.startsWith(".")) r = `./${r}`;
        return r;
    }

    // 5. Apply.
    let total = 0;
    for (const [file, list] of edits) {
        // Overlap guard: two edits at one point keep source order of insertion.
        list.sort(
            (a, b) =>
                b.pos - a.pos ||
                b.end - a.end ||
                (b.closes ?? 0) - (a.closes ?? 0)
        );
        let text = readFileSync(file, "utf8");
        for (const e of list) {
            text = text.slice(0, e.pos) + e.text + text.slice(e.end);
        }
        total += list.length;
        if (!checkOnly) writeFileSync(file, text);
    }
    console.log(
        `codemod: ${total} edits in ${edits.size} files` +
            ` (${[...declTargets.values()].reduce((n, l) => n + l.length, 0)} declarations)`
    );
    if (checkOnly && total > 0) process.exit(1);
}

main();
