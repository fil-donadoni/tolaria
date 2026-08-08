import * as ts from "typescript";

/**
 * Identity-test classifier.
 *
 * An **identity block** is an `it()` / `test()` whose body asserts something
 * (`expect(...)` is present) but never calls anything that could compute an
 * answer: no engine entry point, no fixture builder, no reducer, no validator.
 * All it does is re-read static data — a card definition, a registry row — and
 * hand-copy it into an `expect`. The definition is written twice and the second
 * copy is called a test.
 *
 * Such a block cannot fail for a reason anyone wants to hear about. It goes red
 * on every edit to the definition, legitimate or not, and green whenever the
 * definition is self-consistent — including when the card is completely inert
 * in the engine. It reads as coverage in a describe that has none.
 *
 *     it("has flying", () => {
 *         expect(SERRA_ANGEL.staticAbilities).toContain("flying");   // identity
 *     });
 *
 *     it("flies over a ground blocker", () => {
 *         const state = makeState(...);                               // a CALL
 *         expect(getLegalBlockers(state, angel)).toEqual([]);         // behaviour
 *     });
 *
 * ── The neutral vocabulary ───────────────────────────────────────────────────
 * A call is **neutral** when it cannot introduce behaviour under test: `expect`
 * and its matcher chain, array/string/collection methods on a value the block
 * already had, and the JS built-in statics (`Object.*`, `JSON.*`, `Math.*`,
 * `Number/String/Array/Set/Map` statics, `structuredClone`). Everything else is
 * a **behavioural call** — one non-neutral call anywhere in the body and the
 * block is not identity.
 *
 * Neutral is deliberately generous. A false NEGATIVE (a real identity block the
 * classifier lets through) costs one dead test; a false POSITIVE (a genuine
 * behaviour test reported as a tautology) costs a deleted assertion, which is
 * the failure mode that cannot be recovered from a green suite. The list is
 * closed and named, never "anything that looks lowercase".
 *
 * ── The shared-setup rule ────────────────────────────────────────────────────
 * The vocabulary alone is not enough. This block calls nothing:
 *
 *     const state = makeState({ battlefield: [angel] });   // outer scope
 *     it("...", () => {
 *         expect(getEffectivePower(state, angel)).toBe(4); // ← a real call
 *     });
 *
 * …but a body reading an outer-scope binding whose initialiser WAS a real call
 * is exercising that call's result, one `beforeEach` away. Such a block is NOT
 * identity, and the classifier resolves free identifiers against the enclosing
 * `describe` / module scopes to say so. Missing this rule is how a sweep like
 * this deletes real tests: the call simply moved up a level.
 *
 * Blocks with no `expect()` at all are never identity — they assert nothing, so
 * there is nothing tautological about them (a `.skip`ped stub, a smoke run that
 * only checks the code does not throw).
 */

/** Built-in namespaces whose statics compute nothing about the system. */
const NEUTRAL_GLOBALS = new Set([
    "Object",
    "JSON",
    "Math",
    "Number",
    "String",
    "Array",
    "Boolean",
    "Set",
    "Map",
    "structuredClone",
]);

/**
 * Methods that transform or interrogate a value the block already holds.
 * Called on the definition itself these compute nothing new — `.map()` over
 * `def.staticAbilities` is still just `def.staticAbilities`.
 */
const NEUTRAL_METHODS = new Set([
    // array / iterable
    "map",
    "filter",
    "slice",
    "concat",
    "includes",
    "indexOf",
    "lastIndexOf",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "some",
    "every",
    "sort",
    "reverse",
    "join",
    "flat",
    "flatMap",
    "forEach",
    "reduce",
    "at",
    "pop",
    "shift",
    "keys",
    "values",
    "entries",
    "has",
    "get",
    "add",
    // string
    "startsWith",
    "endsWith",
    "toLowerCase",
    "toUpperCase",
    "trim",
    "split",
    "replace",
    "replaceAll",
    "match",
    "padStart",
    "padEnd",
    "repeat",
    "toString",
    "charAt",
    "substring",
    "normalize",
    // object
    "hasOwnProperty",
]);

/** Matcher names and the chain helpers around them. */
const NEUTRAL_MATCHER_CHAIN = new Set([
    "not",
    "resolves",
    "rejects",
    "toBe",
    "toEqual",
    "toStrictEqual",
    "toMatchObject",
    "toContain",
    "toContainEqual",
    "toHaveLength",
    "toHaveProperty",
    "toBeDefined",
    "toBeUndefined",
    "toBeNull",
    "toBeTruthy",
    "toBeFalsy",
    "toBeNaN",
    "toBeGreaterThan",
    "toBeGreaterThanOrEqual",
    "toBeLessThan",
    "toBeLessThanOrEqual",
    "toBeCloseTo",
    "toBeInstanceOf",
    "toMatch",
    "toThrow",
    "toThrowError",
    "toSatisfy",
    "toMatchInlineSnapshot",
    "toMatchSnapshot",
]);

/** The block-declaring globals — recognised so `describe`/`it` nesting works. */
const BLOCK_FNS = new Set(["it", "test"]);
const SUITE_FNS = new Set(["describe", "suite"]);

export type Verdict = "identity" | "behavioural" | "no-assertion";

export interface TestBlock {
    /** Path as handed to the classifier — echoed back unchanged. */
    file: string;
    /** 1-based line of the `it(` / `test(` call. */
    line: number;
    /** The block's title, or null when it is not a string literal. */
    title: string | null;
    /** Enclosing `describe` titles, outermost first. */
    describeChain: string[];
    verdict: Verdict;
    /**
     * For a `behavioural` verdict, the name that made it so — the callee, or
     * the outer-scope binding whose initialiser was a real call. Null
     * otherwise. Diagnostic only.
     */
    reason: string | null;
}

/** `x!`, `(x)`, `x as T` — wrappers that do not change what is evaluated. */
function unwrap(node: ts.Expression): ts.Expression {
    let cur = node;
    for (;;) {
        if (
            ts.isNonNullExpression(cur) ||
            ts.isParenthesizedExpression(cur) ||
            ts.isAsExpression(cur) ||
            ts.isSatisfiesExpression(cur) ||
            ts.isTypeAssertionExpression(cur)
        ) {
            cur = cur.expression;
            continue;
        }
        return cur;
    }
}

/**
 * Name of the callee for reporting, e.g. `makeState`, `state.foo.bar`.
 * Best-effort: a computed or otherwise exotic callee reports as `<expr>`.
 */
function calleeName(callee: ts.Expression): string {
    const c = unwrap(callee);
    if (ts.isIdentifier(c)) return c.text;
    if (ts.isPropertyAccessExpression(c))
        return `${calleeName(c.expression)}.${c.name.text}`;
    if (ts.isCallExpression(c)) return `${calleeName(c.expression)}()`;
    return "<expr>";
}

/**
 * Is this callee neutral — i.e. incapable of introducing behaviour under test?
 *
 * `expect(...)` and every matcher hanging off it, the built-in statics, and the
 * collection/string methods. A bare lowercase identifier is NOT neutral: that
 * is exactly the fixture builder or engine entry point we are looking for.
 */
function isNeutralCallee(callee: ts.Expression): boolean {
    const c = unwrap(callee);

    if (ts.isIdentifier(c)) {
        return c.text === "expect" || NEUTRAL_GLOBALS.has(c.text);
    }

    if (ts.isPropertyAccessExpression(c)) {
        const method = c.name.text;
        if (NEUTRAL_MATCHER_CHAIN.has(method)) return true;
        if (NEUTRAL_METHODS.has(method)) return true;
        const receiver = unwrap(c.expression);
        // Object.keys / JSON.stringify / Array.from / …
        if (ts.isIdentifier(receiver) && NEUTRAL_GLOBALS.has(receiver.text)) {
            return true;
        }
        // A method NOT in the neutral list, called on anything, is behavioural:
        // `def.resolve(ctx)` and `registry.lookup(id)` both land here.
        return false;
    }

    // `foo()()` — judge by the inner callee; an unknown call producing a
    // callable is not something the neutral vocabulary covers.
    if (ts.isCallExpression(c)) return isNeutralCallee(c.expression);

    return false;
}

/** Every identifier a block body reads but does not itself declare. */
function freeIdentifiers(body: ts.Node): Set<string> {
    const declared = new Set<string>();
    const read = new Set<string>();

    const collectBindingNames = (name: ts.BindingName) => {
        if (ts.isIdentifier(name)) {
            declared.add(name.text);
            return;
        }
        for (const el of name.elements) {
            if (ts.isBindingElement(el)) collectBindingNames(el.name);
        }
    };

    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node)) collectBindingNames(node.name);
        else if (ts.isParameter(node)) collectBindingNames(node.name);
        else if (ts.isFunctionDeclaration(node) && node.name)
            declared.add(node.name.text);
        // The `x` in `obj.x` is a property name, not a reference to a binding.
        else if (ts.isPropertyAccessExpression(node)) {
            visit(node.expression);
            return;
        } else if (
            ts.isPropertyAssignment(node) &&
            ts.isIdentifier(node.name)
        ) {
            visit(node.initializer);
            return;
        } else if (ts.isIdentifier(node)) {
            read.add(node.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(body);

    for (const d of declared) read.delete(d);
    return read;
}

/**
 * Bindings visible from an enclosing scope, mapped to the behavioural call that
 * produced them — or `null` when the binding is plain data. Reading a non-null
 * one inside a block means the block depends on that call's result, so the
 * block is behavioural even though its own body calls nothing.
 *
 * Plain-data bindings are recorded as `null` rather than omitted so that an
 * inner scope can SHADOW a same-named behavioural binding from an outer one.
 */
type BehaviouralBindings = Map<string, string | null>;

function initialiserIsBehavioural(init: ts.Expression): string | null {
    let found: string | null = null;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isCallExpression(node) && !isNeutralCallee(node.expression)) {
            found = calleeName(node.expression);
            return;
        }
        if (ts.isNewExpression(node)) {
            const n = calleeName(node.expression);
            // `new Set(...)` / `new Map(...)` build plain data.
            if (!NEUTRAL_GLOBALS.has(n)) {
                found = `new ${n}`;
                return;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(init);
    return found;
}

/** Classify one block body against the bindings visible around it. */
function classifyBody(
    body: ts.Node,
    outer: BehaviouralBindings
): { verdict: Verdict; reason: string | null } {
    let hasExpect = false;
    let behavioural: string | null = null;

    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
            const callee = unwrap(node.expression);
            if (ts.isIdentifier(callee) && callee.text === "expect") {
                hasExpect = true;
            }
            if (!behavioural && !isNeutralCallee(node.expression)) {
                behavioural = calleeName(node.expression);
            }
        }
        if (!behavioural && ts.isNewExpression(node)) {
            const n = calleeName(node.expression);
            if (!NEUTRAL_GLOBALS.has(n)) behavioural = `new ${n}`;
        }
        ts.forEachChild(node, visit);
    };
    visit(body);

    if (!behavioural && outer.size > 0) {
        // Shared-setup rule: a free identifier bound outside to a real call.
        for (const name of freeIdentifiers(body)) {
            const via = outer.get(name);
            if (via) {
                behavioural = `${name} (bound outside via ${via})`;
                break;
            }
        }
    }

    if (behavioural) return { verdict: "behavioural", reason: behavioural };
    if (!hasExpect) return { verdict: "no-assertion", reason: null };
    return { verdict: "identity", reason: null };
}

function literalTitle(node: ts.CallExpression): string | null {
    const arg = node.arguments[0];
    return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
}

/** `it`, `it.only`, `test.each(...)` — the root identifier of the callee. */
function blockKeyword(callee: ts.Expression): string | null {
    let cur = unwrap(callee);
    for (;;) {
        if (ts.isIdentifier(cur)) return cur.text;
        if (ts.isPropertyAccessExpression(cur)) {
            cur = unwrap(cur.expression);
            continue;
        }
        if (ts.isCallExpression(cur)) {
            cur = unwrap(cur.expression);
            continue;
        }
        return null;
    }
}

/**
 * Classify every `it()` / `test()` block in one test source.
 *
 * Pure and self-contained: takes source text, never touches the filesystem, so
 * the unit test can feed it synthetic files.
 */
export function classifyTestBlocks(file: string, source: string): TestBlock[] {
    const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const lineOf = (n: ts.Node) =>
        sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const blocks: TestBlock[] = [];
    const describeChain: string[] = [];
    // One frame per enclosing scope; a block sees the union of all of them.
    const bindingScopes: BehaviouralBindings[] = [new Map()];

    const visibleBindings = (): BehaviouralBindings => {
        const merged: BehaviouralBindings = new Map();
        for (const scope of bindingScopes) {
            for (const [k, v] of scope) merged.set(k, v);
        }
        return merged;
    };

    const visit = (node: ts.Node) => {
        // Record bindings as we pass them, so a block sees what precedes it.
        if (
            ts.isVariableDeclaration(node) &&
            node.initializer &&
            ts.isIdentifier(node.name)
        ) {
            const current = bindingScopes[bindingScopes.length - 1];
            current.set(
                node.name.text,
                initialiserIsBehavioural(node.initializer)
            );
        }

        if (ts.isCallExpression(node)) {
            const keyword = blockKeyword(node.expression);

            if (keyword && SUITE_FNS.has(keyword)) {
                describeChain.push(literalTitle(node) ?? "<dynamic>");
                bindingScopes.push(new Map());
                ts.forEachChild(node, visit);
                bindingScopes.pop();
                describeChain.pop();
                return;
            }

            if (keyword && BLOCK_FNS.has(keyword)) {
                const fn = node.arguments.find(
                    (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)
                );
                if (
                    fn &&
                    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
                ) {
                    const { verdict, reason } = classifyBody(
                        fn.body,
                        visibleBindings()
                    );
                    blocks.push({
                        file,
                        line: lineOf(node),
                        title: literalTitle(node),
                        describeChain: [...describeChain],
                        verdict,
                        reason,
                    });
                }
                // Do not descend: a nested `it` is not a thing, and descending
                // would re-scan the body we just classified.
                return;
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(sf);
    return blocks;
}

/** Convenience: just the identity blocks. */
export function findIdentityBlocks(file: string, source: string): TestBlock[] {
    return classifyTestBlocks(file, source).filter(
        (b) => b.verdict === "identity"
    );
}
