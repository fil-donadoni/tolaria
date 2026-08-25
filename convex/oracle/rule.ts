/**
 * Parser combinators for the Oracle compiler — the layer that makes a partial
 * parse UNREPRESENTABLE rather than merely detectable.
 *
 * ── The defect class this exists to prevent ────────────────────────────────
 *
 * The competitor this project measured itself against (phase.rs) reports ~4,700
 * silently misparsed cards behind an 88% "supported" figure. Every documented
 * shape is the same bug: a rule matched a PREFIX of its input and the remainder
 * was dropped — a trailing filter, an intervening-if, the second half of a
 * conjunction. Nothing in the output says so; the player finds out in-game.
 *
 * The usual combinator signature invites exactly that, because success carries
 * a residue (`{ value, rest }`) and every call site is free to ignore `rest`.
 * Ignoring it is one keystroke and looks identical to correct code.
 *
 * ── The three structural guarantees ────────────────────────────────────────
 *
 * 1. NO RESIDUE FIELD. `RuleResult` has no `rest`. A `Rule<T>` either consumed
 *    its entire span or it failed. There is nowhere to put leftovers, so
 *    leftovers cannot be silently dropped — a caller cannot forget to check a
 *    field that does not exist.
 *
 * 2. SPLITS COVER BY CONSTRUCTION. Structure is built by SPLITTING a span, not
 *    by advancing a cursor. `pair` and `listOf` obtain their sub-spans from
 *    `String.prototype.split`, whose parts satisfy `parts.join(sep) === span`
 *    as an identity. Coverage is therefore an algebraic property of the split,
 *    not an assertion someone has to remember to write.
 *
 * 3. NO FIRST-BRANCH FALLBACK. `oneOf` is not `alt`. It runs EVERY alternative
 *    and requires exactly one to succeed; two successes are an ambiguity and
 *    fail the card. "First alternative that matches wins" is how a permissive
 *    parser picks the wrong reading of a line it half-understands, so the
 *    primitive that would allow it is simply absent from this module.
 *
 * Leaves are `atom` (exact table lookup, no regex at all) and `pattern`, whose
 * regex must be anchored at BOTH ends — enforced at construction time, because
 * an unanchored regex is guarantee 1 defeated from the inside.
 */

/**
 * Success carries a value and nothing else. There is deliberately no residue:
 * see guarantee 1 above.
 */
export type RuleResult<T> =
    | { readonly ok: true; readonly value: T }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly fragment: string;
      };

export interface Rule<T> {
    /** Stable name, used in gap reasons and in the per-slot precision report. */
    readonly label: string;
    readonly run: (span: string, ctx: RuleContext) => RuleResult<T>;
}

/** Whatever the grammar's rules may consult; kept opaque here to avoid a cycle. */
export type RuleContext = unknown;

export function ok<T>(value: T): RuleResult<T> {
    return { ok: true, value };
}

export function fail(reason: string, fragment: string): RuleResult<never> {
    return { ok: false, reason, fragment };
}

export function rule<T>(
    label: string,
    run: (span: string, ctx: RuleContext) => RuleResult<T>
): Rule<T> {
    return { label, run };
}

/**
 * Apply a rule to a whole span. This is the only entry point; because
 * `RuleResult` has no residue there is no "and now check the cursor" step to
 * skip.
 */
export function parse<T>(
    r: Rule<T>,
    span: string,
    ctx: RuleContext
): RuleResult<T> {
    return r.run(span, ctx);
}

/** Exact, case-insensitive literal. Matches iff it IS the whole span. */
export function literal(text: string): Rule<string> {
    return rule(`"${text}"`, (span) =>
        span.toLowerCase() === text.toLowerCase()
            ? ok(span)
            : fail(`expected "${text}"`, span)
    );
}

/**
 * Exact table lookup — the safest leaf there is: the span must BE one of the
 * keys, so residue is impossible without a regex being involved at all. Keys
 * are matched case-insensitively; the table is built once by the caller.
 */
export function atom<T>(label: string, table: ReadonlyMap<string, T>): Rule<T> {
    return rule(label, (span) => {
        const hit = table.get(span.toLowerCase());
        return hit === undefined ? fail(`not a known ${label}`, span) : ok(hit);
    });
}

/**
 * Anchored-regex leaf.
 *
 * The `^`/`$` requirement is enforced at CONSTRUCTION and throws — a developer
 * error, not a parse failure — because an unanchored regex reintroduces exactly
 * the prefix-match bug this module exists to make impossible, and it would do
 * so invisibly: the rule would still return a value and still look correct.
 *
 * The mapper receives the match; a mapper may reject (return a `RuleResult`),
 * which is how a leaf whose SHAPE is regular but whose VALUE is out of range
 * (an unknown mana symbol, a number too large) fails closed.
 */
export function pattern<T>(
    label: string,
    re: RegExp,
    map: (match: RegExpMatchArray, span: string) => RuleResult<T> | T
): Rule<T> {
    if (!re.source.startsWith("^") || !re.source.endsWith("$")) {
        throw new Error(
            `oracle grammar: pattern "${label}" must be anchored ^…$ — an unanchored ` +
                `regex can match a prefix and silently drop the rest of the span`
        );
    }
    if (re.global) {
        throw new Error(
            `oracle grammar: pattern "${label}" must not be /g (lastIndex is state)`
        );
    }
    return rule(label, (span) => {
        const m = span.match(re);
        if (m === null) return fail(`does not match ${label}`, span);
        // Belt-and-braces: an anchored match always spans the input, but a
        // pattern composed from another RegExp's `source` could smuggle in an
        // alternation that escapes the anchors (`^a$|b`).
        if (m[0] !== span)
            return fail(`${label} did not consume the whole span`, span);
        const mapped = map(m, span);
        return typeof mapped === "object" && mapped !== null && "ok" in mapped
            ? (mapped as RuleResult<T>)
            : ok(mapped as T);
    });
}

/**
 * UNIQUE alternation — every alternative is tried, exactly one must succeed.
 *
 * This is not an optimisation of `alt`, it is a different operator. `alt`
 * (first match wins) makes rule ORDER load-bearing: a broad early rule shadows
 * a precise later one and the card compiles to the wrong reading with no
 * diagnostic. `oneOf` cannot do that — an input two rules both accept is an
 * ambiguity in the GRAMMAR, and the honest answer is to fail the card until a
 * human disambiguates it.
 */
export function oneOf<T>(label: string, alts: readonly Rule<T>[]): Rule<T> {
    if (alts.length === 0)
        throw new Error(`oracle grammar: oneOf "${label}" has no alternatives`);
    return rule(label, (span, ctx) => {
        const hits: { alt: Rule<T>; value: T }[] = [];
        const misses: string[] = [];
        for (const alt of alts) {
            const r = alt.run(span, ctx);
            if (r.ok) hits.push({ alt, value: r.value });
            else misses.push(`${alt.label}: ${r.reason}`);
        }
        if (hits.length === 1) return ok(hits[0]!.value);
        if (hits.length === 0)
            return fail(`no ${label} matched (${misses.join("; ")})`, span);
        // The labels are SORTED, not listed in declaration order: the whole
        // point of `oneOf` is that the answer does not depend on the order of
        // its alternatives, and a diagnostic that does would leak that
        // dependency into the lockfile as a spurious diff.
        return fail(
            `ambiguous ${label}: ${hits
                .map((h) => h.alt.label)
                .sort()
                .join(" and ")} both consumed it`,
            span
        );
    });
}

/**
 * Split the span on every occurrence of `sep` and parse each part.
 *
 * Coverage is structural: `span.split(sep).join(sep) === span` for a string
 * separator, always. Every part must be consumed by `part`, so a list cannot
 * lose its tail — the classic "conjoined clause dropped" bug.
 *
 * `min` guards the degenerate case where a rule intended for a list silently
 * accepts a single element (or vice versa).
 */
export function listOf<T>(
    label: string,
    sep: string,
    part: Rule<T>,
    opts: { readonly min?: number } = {}
): Rule<T[]> {
    if (sep.length === 0)
        throw new Error(`oracle grammar: listOf "${label}" needs a separator`);
    const min = opts.min ?? 1;
    return rule(label, (span, ctx) => {
        const parts = span.split(sep);
        if (parts.length < min)
            return fail(`${label} needs at least ${min} element(s)`, span);
        const out: T[] = [];
        for (const p of parts) {
            const r = part.run(p, ctx);
            if (!r.ok)
                return fail(`${label} element — ${r.reason}`, r.fragment);
            out.push(r.value);
        }
        return ok(out);
    });
}

/**
 * Split the span into exactly two sides at `sep` and parse both.
 *
 * EVERY occurrence of the separator is tried as the split point and exactly one
 * must yield a parse of both sides. Taking the first viable split would be the
 * same first-branch fallback `oneOf` forbids, one level down: `"{T}, Sacrifice
 * this: Add {B}: …"` must not quietly pick the earlier colon.
 */
export function pair<A, B, T>(
    label: string,
    sep: string,
    left: Rule<A>,
    right: Rule<B>,
    combine: (a: A, b: B) => T
): Rule<T> {
    if (sep.length === 0)
        throw new Error(`oracle grammar: pair "${label}" needs a separator`);
    return rule(label, (span, ctx) => {
        const hits: T[] = [];
        const misses: string[] = [];
        let at = span.indexOf(sep);
        while (at !== -1) {
            const l = span.slice(0, at);
            const r = span.slice(at + sep.length);
            const lr = left.run(l, ctx);
            const rr = lr.ok ? right.run(r, ctx) : null;
            if (lr.ok && rr !== null && rr.ok)
                hits.push(combine(lr.value, rr.value));
            else if (!lr.ok) misses.push(`${left.label}: ${lr.reason}`);
            else if (rr !== null && !rr.ok)
                misses.push(`${right.label}: ${rr.reason}`);
            at = span.indexOf(sep, at + 1);
        }
        if (hits.length === 1) return ok(hits[0]!);
        if (hits.length === 0) {
            return fail(
                misses.length > 0
                    ? `${label} — ${misses.join("; ")}`
                    : `${label} — no "${sep}" in the span`,
                span
            );
        }
        return fail(
            `ambiguous ${label}: ${hits.length} viable "${sep}" split points`,
            span
        );
    });
}

/**
 * Require the span to end with `terminator` and parse what precedes it.
 *
 * Coverage is structural for the same reason `pair`'s is: when `endsWith`
 * holds, `head + terminator === span` is an identity. This is how a sentence's
 * full stop is consumed — CR 113.3b writes an activated ability as
 * "[Cost]: [Effect.]", so the period belongs to the ability, not to the effect.
 */
export function terminated<T>(terminator: string, inner: Rule<T>): Rule<T> {
    if (terminator.length === 0) {
        throw new Error("oracle grammar: terminated() needs a terminator");
    }
    return rule(`${inner.label}"${terminator}"`, (span, ctx) => {
        if (!span.endsWith(terminator)) {
            return fail(`expected the span to end with "${terminator}"`, span);
        }
        return inner.run(span.slice(0, span.length - terminator.length), ctx);
    });
}

/** Map a rule's value. Cannot affect consumption — there is nothing to consume. */
export function map<A, B>(r: Rule<A>, f: (a: A) => RuleResult<B> | B): Rule<B> {
    return rule(r.label, (span, ctx) => {
        const inner = r.run(span, ctx);
        if (!inner.ok) return inner;
        const out = f(inner.value);
        return typeof out === "object" && out !== null && "ok" in out
            ? (out as RuleResult<B>)
            : ok(out as B);
    });
}

/**
 * A rule that always fails, with a stable reason. This is what an unimplemented
 * slot or sub-grammar IS — not an empty function that returns a neutral value.
 * A stub that fails is fail-closed; a stub that returns `{}` is a silent
 * misparse waiting for its first caller.
 */
export function notYetImplemented<T>(label: string, ticket: string): Rule<T> {
    return rule(label, (span) =>
        fail(`${label} is not in grammar v0 (${ticket})`, span)
    );
}
