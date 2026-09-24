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
 *
 * ── The definition-read rule (issue #4489) ───────────────────────────────────
 * One real call clears a block WHOLE, which hides the identity LINE inside it:
 *
 *     it("Serra Angel flies over a ground blocker", () => {
 *         expect(serraAngel.staticAbilities).toContain("flying"); // ← identity
 *         expect(getLegalBlockers(state, angel)).toEqual([]);     // behaviour
 *     });
 *
 * So every `expect(<cardDef>.field…)` inside a behavioural block is reported as
 * a line of its own (`TestBlock.definitionReads`). A **card definition** is a
 * binding initialised by a catalogue lookup with a literal argument
 * (`getDefinition("…")`, `getCardByName("…")`, …), an alias that is a pure
 * property chain off one, a lookup call written inline, or an import from a
 * card-set module. The expect SUBJECT must be rooted at one and read at least
 * one field off it; the definition appearing only in the matcher's expected
 * value (`toBe(bolt.id)`) is a comparison, not a read.
 *
 * ── The Op-only class (issue #4489) ──────────────────────────────────────────
 * ADR 0045's per-Op regime covers a DSL card on exercised Ops with no per-card
 * test at all (static sweep + generated smoke test). A behavioural block on
 * such a card that only casts/resolves it and asserts what the Op's own test
 * asserts proves nothing the Op test does not — and reds on every Op refactor.
 * It is `opOnly.kind === "op-only"` when ALL of these hold, and every clause
 * fails CLOSED (anything the rule cannot see clears the block):
 *
 *   1. every call is neutral, a fixture builder, a catalogue lookup, or a
 *      cast/resolve entry point (`OP_ONLY_CALLS`) — any other call is
 *      card-owned code or engine surface the Op test does not cover (a
 *      trigger scan, a legality query, the projection, a choice submit);
 *   2. no identifier or property names card-owned code
 *      (`CARD_OWNED_NAME`: trigger, kicker, cost, restriction, matcher,
 *      projection, legality);
 *   3. every `expect` subject reads an Op outcome (`OUTCOME_FIELDS`: zone,
 *      damage, counters, life, and the zone arrays a draw moves through);
 *   4. every outer binding the block reads was built by the same vocabulary
 *      (an uninitialised `let` filled in a `beforeEach` is opaque → cleared);
 *   5. the block names at least one catalogue card, and EVERY card it names is
 *      pure-DSL per the caller's `CardFacts` (no `resolve()`, static or
 *      replacement effect, not on the smoke skip list).
 *
 * The class is evaluated only when the caller passes `CardFacts` — the
 * classifier stays pure and never loads the catalogue itself.
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

/**
 * The Op-only vocabulary: fixture builders and the cast/resolve entry points.
 * Closed and named — a call outside it clears the Op-only class.
 */
export const OP_ONLY_CALLS: ReadonlySet<string> = new Set([
    // fixture builders (`convex/cards/__tests__/setup.ts`)
    "makeState",
    "makePlayer",
    "makeInstance",
    "getPlayer",
    // cast / resolve entry points
    "pushSpell",
    "resolveTopOfStack",
    "resolveActivated",
    // the global rules the Op's outcome passes through — not card-owned (a
    // card's `sbaMods` exception disqualifies the CARD instead)
    "checkStateBasedActions",
    // Op outcome queries: the P/T a pump Op leaves, read through the layers
    // (the card is pure-DSL, so no static effect of its own is in them)
    ...["getEffectivePower", "getEffectiveToughness"],
]);

/** Calls whose RESULT is an Op outcome, so an expect over one satisfies clause 3. */
const OUTCOME_QUERIES = new Set(["getEffectivePower", "getEffectiveToughness"]);

/** Catalogue lookups: their literal argument names the card a block is about. */
export const CARD_LOOKUP_CALLS: ReadonlySet<string> = new Set([
    "getDefinition",
    "tryGetDefinition",
    "getCardByName",
    "byId",
]);

/** Methods that mutate a fixture the block built (`hand.push(card)`). */
const FIXTURE_METHODS = new Set(["push", "unshift"]);

/**
 * Fields an Op's own per-Op test asserts: zone, damage, counters, life, the
 * zone arrays a draw / move / destroy lands a card in, and the direct state an
 * Op writes (tapped, a regeneration shield, mana added).
 */
export const OUTCOME_FIELDS: ReadonlySet<string> = new Set([
    "life",
    "damageMarked",
    "counters",
    "isTapped",
    "regenerationShields",
    "manaPool",
    "zone",
    "hand",
    "library",
    "graveyard",
    "battlefield",
    "exile",
]);

/** A name that points at card-owned code the Op test does not cover. */
export const CARD_OWNED_NAME =
    /trigger|kick|cost|restrict|matcher|project|legal|canCast|canActivate/i;

/** A uuid string literal — how set tests name a card by id. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A module path that exports card definitions directly. */
const CARD_MODULE =
    /(^|\/)(sets\/[^/]+\/)?(white|blue|black|red|green|colorless|multicolor|lands)$|\/cards\/sets\//;

/** What the caller knows about one catalogue card. */
export interface CardFact {
    id: string;
    name: string;
    /** Why the card owns code a per-card test may legitimately cover, or null when it is pure-DSL. */
    ownsCode: string | null;
}

/** The catalogue as the Op-only class sees it — supplied by the caller. */
export interface CardFacts {
    byId(id: string): CardFact | undefined;
    byName(name: string): CardFact | undefined;
}

export interface ClassifyOptions {
    /** Enables the Op-only class; without it `opOnly` is null on every block. */
    cards?: CardFacts;
    /**
     * Source of a RELATIVE import (`./helpers`), or undefined when it cannot be
     * read. Lets a call to an imported fixture helper count as the calls its
     * body makes, one module deep; without it such a call clears the block.
     */
    readImport?: (fromFile: string, specifier: string) => string | undefined;
}

/** Which Op-only clause cleared a block — the header's clauses 1–5. */
export type OpOnlyRule =
    | "no-catalogue-card" // 5: names no card the catalogue knows
    | "card-owns-code" // 5: a named card is not pure-DSL
    | "foreign-call" // 1: a call outside the vocabulary
    | "opaque-binding" // 4: reads a binding with no initialiser
    | "card-owned-name" // 2: names card-owned code
    | "non-outcome-assertion"; // 3: an expect not about an Op outcome

export type OpOnlyVerdict =
    | { kind: "op-only"; cards: string[] }
    | { kind: "cleared"; rule: OpOnlyRule; reason: string };

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
    /**
     * 1-based lines of `expect(<cardDef>.field)` inside a `behavioural` block
     * — the definition-read rule. Empty for every other verdict (an identity
     * block is flagged whole).
     */
    definitionReads: number[];
    /**
     * The Op-only class for a `behavioural` block with an assertion, when the
     * caller passed `CardFacts`; null otherwise.
     */
    opOnly: OpOnlyVerdict | null;
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

/** A card named by a literal: `getDefinition("<uuid>")`, `getCardByName("Name")`, a bare uuid. */
interface CardRef {
    id?: string;
    name?: string;
}

/**
 * What the Op-only class and the definition-read rule know about one binding.
 * Transitive: a binding built from other bindings inherits their callees, card
 * references and opacity, so `const lion = makeInstance(savannahLions.id)`
 * names Savannah Lions.
 */
interface Binding {
    /** Short names of every non-neutral call that produced the value. */
    callees: string[];
    cardRefs: CardRef[];
    /** The value IS a card definition (a lookup, an alias chain off one, a card-module import). */
    cardDef: boolean;
    /** Declared without an initialiser — filled in elsewhere (`beforeEach`), provenance unknown. */
    opaque: boolean;
    /**
     * A file-local helper (`const setup = () => …`, `function board() …`):
     * calling it is calling what its body calls, so the call itself adds no
     * callee — its body's callees and card references already ride on the
     * binding.
     */
    helper?: boolean;
}

type Bindings = Map<string, Binding>;

/** `makeState` for `makeState(…)`, `push` for `hand.push(…)`. */
function shortCalleeName(callee: ts.Expression): string {
    const c = unwrap(callee);
    if (ts.isIdentifier(c)) return c.text;
    if (ts.isPropertyAccessExpression(c)) return c.name.text;
    return "<expr>";
}

/** `getDefinition("…")` → the card it names, or null when not a literal catalogue lookup. */
function cardLookupRef(node: ts.Node): CardRef | null {
    if (!ts.isCallExpression(node)) return null;
    const callee = unwrap(node.expression);
    if (!ts.isIdentifier(callee) || !CARD_LOOKUP_CALLS.has(callee.text))
        return null;
    const arg = node.arguments[0];
    if (!arg || !ts.isStringLiteralLike(arg)) return null;
    return callee.text === "getCardByName"
        ? { name: arg.text }
        : { id: arg.text };
}

/** Is `expr` a card definition — a lookup, a definition binding, or a chain off one? */
function isCardDefExpr(expr: ts.Expression, bindings: Bindings): boolean {
    const e = unwrap(expr);
    if (cardLookupRef(e)) return true;
    if (ts.isIdentifier(e)) return bindings.get(e.text)?.cardDef ?? false;
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e))
        return isCardDefExpr(e.expression, bindings);
    return false;
}

/** Callees, card references and opacity of an expression, following the bindings it reads. */
function describeExpression(node: ts.Node, bindings: Bindings): Binding {
    const out: Binding = {
        callees: [],
        cardRefs: [],
        cardDef: false,
        opaque: false,
    };
    const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
            const ref = cardLookupRef(n);
            if (ref) out.cardRefs.push(ref);
            const callee = unwrap(n.expression);
            const viaHelper =
                ts.isIdentifier(callee) && bindings.get(callee.text)?.helper;
            // `expect.arrayContaining(…)` and friends build a matcher, nothing more.
            const asymmetricMatcher =
                ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.expression) &&
                callee.expression.text === "expect";
            if (
                !viaHelper &&
                !asymmetricMatcher &&
                !isNeutralCallee(n.expression)
            )
                out.callees.push(shortCalleeName(n.expression));
        } else if (ts.isNewExpression(n)) {
            const name = calleeName(n.expression);
            if (!NEUTRAL_GLOBALS.has(name)) out.callees.push(`new ${name}`);
        } else if (ts.isStringLiteralLike(n) && UUID.test(n.text)) {
            out.cardRefs.push({ id: n.text });
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    for (const name of freeIdentifiers(node)) {
        const b = bindings.get(name);
        if (!b) continue;
        out.callees.push(...b.callees);
        out.cardRefs.push(...b.cardRefs);
        out.opaque ||= b.opaque;
    }
    return out;
}

function bindingFor(decl: ts.VariableDeclaration, bindings: Bindings): Binding {
    if (!decl.initializer)
        return { callees: [], cardRefs: [], cardDef: false, opaque: true };
    const init = unwrap(decl.initializer);
    const b = describeExpression(init, bindings);
    b.cardDef = isCardDefExpr(init, bindings);
    b.helper = ts.isArrowFunction(init) || ts.isFunctionExpression(init);
    return b;
}

/**
 * The top-level bindings of an imported module — its helper functions, data
 * constants and card definitions — analysed in that module's own scope, one
 * level deep (the module's own imports are not followed).
 */
const moduleCache = new Map<string, Bindings>();

function moduleBindings(file: string, source: string): Bindings {
    const cached = moduleCache.get(source);
    if (cached) return cached;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const scope: Bindings = new Map();
    for (const stmt of sf.statements) {
        if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
            const helper = describeExpression(stmt.body, scope);
            helper.helper = true;
            scope.set(stmt.name.text, helper);
        } else if (ts.isVariableStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
                if (ts.isIdentifier(decl.name))
                    scope.set(decl.name.text, bindingFor(decl, scope));
            }
        }
    }
    moduleCache.set(source, scope);
    return scope;
}

/** Every `expect(<subject>)` call in a body, with its subject. */
function expectSubjects(
    body: ts.Node
): { call: ts.CallExpression; subject: ts.Expression | undefined }[] {
    const out: {
        call: ts.CallExpression;
        subject: ts.Expression | undefined;
    }[] = [];
    const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
            const callee = unwrap(n.expression);
            if (ts.isIdentifier(callee) && callee.text === "expect")
                out.push({ call: n, subject: n.arguments[0] });
        }
        ts.forEachChild(n, visit);
    };
    visit(body);
    return out;
}

/** The block's own `const`/`let` bindings layered over the outer ones, in source order. */
function withLocalBindings(body: ts.Node, outer: Bindings): Bindings {
    const scope: Bindings = new Map(outer);
    const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name))
            scope.set(n.name.text, bindingFor(n, scope));
        ts.forEachChild(n, visit);
    };
    visit(body);
    return scope;
}

/**
 * The definition-read rule: is this expect subject a field read off a card
 * definition? `bolt.manaCost`, `def.activatedAbilities.map(a => a.id)`,
 * `getCardByName("X")!.power` — yes; `bolt`, `state.players[0].life` — no.
 */
function isDefinitionRead(subject: ts.Expression, bindings: Bindings): boolean {
    let cur = unwrap(subject);
    let readsField = false;
    for (;;) {
        if (ts.isPropertyAccessExpression(cur)) {
            readsField = true;
            if (isCardDefExpr(cur.expression, bindings)) return true;
            cur = unwrap(cur.expression);
            continue;
        }
        if (ts.isElementAccessExpression(cur)) {
            readsField = true;
            if (isCardDefExpr(cur.expression, bindings)) return true;
            cur = unwrap(cur.expression);
            continue;
        }
        // `def.x.map(...)` — a neutral method over the definition still reads it.
        if (ts.isCallExpression(cur)) {
            const callee = unwrap(cur.expression);
            if (
                ts.isPropertyAccessExpression(callee) &&
                NEUTRAL_METHODS.has(callee.name.text)
            ) {
                cur = unwrap(callee.expression);
                continue;
            }
            return false;
        }
        // An alias bound to a field of a definition: `const ab = bolt.activatedAbilities[0]`.
        if (ts.isIdentifier(cur)) {
            const b = bindings.get(cur.text);
            return !!b && b.cardDef && readsField;
        }
        return false;
    }
}

function definitionReadLines(
    body: ts.Node,
    bindings: Bindings,
    lineOf: (n: ts.Node) => number
): number[] {
    const lines: number[] = [];
    for (const { call, subject } of expectSubjects(body)) {
        if (subject && isDefinitionRead(subject, bindings))
            lines.push(lineOf(call));
    }
    return lines;
}

/** Every identifier and property name a node mentions. */
function mentionedNames(node: ts.Node): string[] {
    const out: string[] = [];
    const visit = (n: ts.Node) => {
        if (ts.isIdentifier(n)) out.push(n.text);
        ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
}

const isAllowedOpOnlyCall = (name: string) =>
    OP_ONLY_CALLS.has(name) ||
    CARD_LOOKUP_CALLS.has(name) ||
    FIXTURE_METHODS.has(name);

/** The Op-only class for one behavioural block — see the header, clauses 1–5. */
function classifyOpOnly(
    body: ts.Node,
    bindings: Bindings,
    cards: CardFacts
): OpOnlyVerdict {
    const cleared = (rule: OpOnlyRule, reason: string): OpOnlyVerdict => ({
        kind: "cleared",
        rule,
        reason,
    });
    const own = describeExpression(body, bindings);

    // 5 first: at least one catalogue card, every one of them pure-DSL — so
    // the reasons below describe only blocks on pure-DSL cards.
    const named = new Map<string, CardFact>();
    for (const ref of own.cardRefs) {
        const fact = ref.id ? cards.byId(ref.id) : cards.byName(ref.name!);
        if (fact) named.set(fact.id, fact);
    }
    if (named.size === 0)
        return cleared("no-catalogue-card", "names no catalogue card");
    for (const fact of named.values()) {
        if (fact.ownsCode)
            return cleared("card-owns-code", `${fact.name}: ${fact.ownsCode}`);
    }
    // 1 + 4: every call, the block's own and the ones behind the outer bindings it reads.
    const foreign = own.callees.find((c) => !isAllowedOpOnlyCall(c));
    if (foreign) return cleared("foreign-call", `calls ${foreign}`);
    if (own.opaque)
        return cleared("opaque-binding", "reads a binding with no initialiser");

    // 2: card-owned code named anywhere in the body.
    const owned = mentionedNames(body).find(
        (n) =>
            CARD_OWNED_NAME.test(n) &&
            !NEUTRAL_METHODS.has(n) &&
            !NEUTRAL_MATCHER_CHAIN.has(n)
    );
    if (owned)
        return cleared("card-owned-name", `names card-owned code: ${owned}`);

    // 3: every assertion is about an Op outcome.
    for (const { subject } of expectSubjects(body)) {
        const names = subject ? mentionedNames(subject) : [];
        if (!names.some((n) => OUTCOME_FIELDS.has(n) || OUTCOME_QUERIES.has(n)))
            return cleared(
                "non-outcome-assertion",
                `asserts a non-outcome: ${subject?.getText() ?? "<none>"}`
            );
    }

    return {
        kind: "op-only",
        cards: [...named.values()].map((f) => f.name).sort(),
    };
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
export function classifyTestBlocks(
    file: string,
    source: string,
    options: ClassifyOptions = {}
): TestBlock[] {
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
    // `behaviourScopes` is the shared-setup rule's view (initialised bindings
    // only); `bindingScopes` is the Op-only / definition-read view, which also
    // records uninitialised `let`s (as opaque) and card-module imports.
    const behaviourScopes: BehaviouralBindings[] = [new Map()];
    const bindingScopes: Bindings[] = [new Map()];

    const merge = <V>(scopes: Map<string, V>[]): Map<string, V> => {
        const merged = new Map<string, V>();
        for (const scope of scopes) {
            for (const [k, v] of scope) merged.set(k, v);
        }
        return merged;
    };

    const visit = (node: ts.Node) => {
        // Record bindings as we pass them, so a block sees what precedes it.
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            if (node.initializer) {
                behaviourScopes[behaviourScopes.length - 1].set(
                    node.name.text,
                    initialiserIsBehavioural(node.initializer)
                );
            }
            bindingScopes[bindingScopes.length - 1].set(
                node.name.text,
                bindingFor(node, merge(bindingScopes))
            );
        }
        if (ts.isFunctionDeclaration(node) && node.name && node.body) {
            const helper = describeExpression(node.body, merge(bindingScopes));
            helper.helper = true;
            bindingScopes[bindingScopes.length - 1].set(node.name.text, helper);
        }
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            node.moduleSpecifier.text.startsWith(".") &&
            !CARD_MODULE.test(node.moduleSpecifier.text) &&
            options.readImport
        ) {
            const named = node.importClause?.namedBindings;
            const text = options.readImport(file, node.moduleSpecifier.text);
            if (text !== undefined && named && ts.isNamedImports(named)) {
                const exported = moduleBindings(
                    node.moduleSpecifier.text,
                    text
                );
                for (const el of named.elements) {
                    const exportedName = (el.propertyName ?? el.name).text;
                    // The vocabulary is trusted BY NAME: `makeInstance` is a
                    // fixture builder whatever its body calls to mint an id.
                    if (isAllowedOpOnlyCall(exportedName)) continue;
                    const b = exported.get(exportedName);
                    if (b) bindingScopes[0].set(el.name.text, b);
                }
            }
        }
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            CARD_MODULE.test(node.moduleSpecifier.text)
        ) {
            const named = node.importClause?.namedBindings;
            if (named && ts.isNamedImports(named)) {
                for (const el of named.elements) {
                    bindingScopes[0].set(el.name.text, {
                        callees: [],
                        cardRefs: [],
                        cardDef: true,
                        opaque: false,
                    });
                }
            }
        }

        if (ts.isCallExpression(node)) {
            const keyword = blockKeyword(node.expression);

            if (keyword && SUITE_FNS.has(keyword)) {
                describeChain.push(literalTitle(node) ?? "<dynamic>");
                behaviourScopes.push(new Map());
                bindingScopes.push(new Map());
                ts.forEachChild(node, visit);
                bindingScopes.pop();
                behaviourScopes.pop();
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
                        merge(behaviourScopes)
                    );
                    const bindings = merge(bindingScopes);
                    const behavioural = verdict === "behavioural";
                    const asserts = expectSubjects(fn.body).length > 0;
                    blocks.push({
                        file,
                        line: lineOf(node),
                        title: literalTitle(node),
                        describeChain: [...describeChain],
                        verdict,
                        reason,
                        definitionReads: behavioural
                            ? definitionReadLines(
                                  fn.body,
                                  withLocalBindings(fn.body, bindings),
                                  lineOf
                              )
                            : [],
                        opOnly:
                            behavioural && asserts && options.cards
                                ? classifyOpOnly(
                                      fn.body,
                                      bindings,
                                      options.cards
                                  )
                                : null,
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
