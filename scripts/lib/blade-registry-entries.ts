/**
 * The blade registry cut into entries, by SOURCE TEXT (issue #5078).
 *
 * `convex/gre/ai/blade/registry.ts` is one array literal of ~200 `BladeScenario`
 * objects between helper code. Health must decide, from two revisions of that
 * file, which `must` entries a batch added or changed — and entries hold
 * predicates, so they cannot be loaded and compared at the old revision
 * (`health-main.ts` runs on builtins only and the old tree is not checked out).
 * The comparison is therefore textual: an entry's block, comments included, is
 * its definition.
 *
 * Fail-closed by construction: everything that is NOT a literal-labelled entry
 * of the array — helper functions, shared constants, a spread element, a
 * generated entry — is `residue`, and a changed residue means "not an
 * entries-only change" to the caller (`health-robustness-trigger.ts`), which
 * then audits in full. A source this scanner cannot make sense of (array not
 * found, unbalanced brackets, a label it cannot read) parses to `null`, which
 * reads the same way.
 *
 * Scope of the scanner: strings, template literals (with nested `${}`),
 * `//` and block comments. A regex literal is NOT understood — the registry
 * has none, and one would unbalance the depth count into the `null` path.
 *
 * Builtins only — `health-main.ts`'s own constraint.
 */

/** The array the entries live in. */
const ARRAY_HEAD =
    /\bBLADE_SCENARIOS\s*:\s*(?:Registry)?BladeScenario\[\]\s*=\s*\[/;

export interface RegistryEntries {
    /** Entry label → the entry's source block: its leading comments and the
     *  `{ … }`, without the separating comma. */
    blocks: ReadonlyMap<string, string>;
    /** Everything else, the entries (and their commas) cut out. */
    residue: string;
}

interface Masked {
    /** `src` with every string interior, comment and template body blanked. */
    masked: string;
}

/** Blank strings, templates and comments so that structural characters in
 *  them are invisible; quotes stay, so a masked `label: "` is still findable.
 *  Returns `null` on an unterminated construct. */
function mask(src: string): Masked | null {
    const out = src.split("");
    const n = src.length;
    const blank = (from: number, to: number) => {
        for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
    };
    // Template literal body starting after its opening backtick at `i`;
    // returns the index of the closing backtick, or -1.
    const template = (start: number): number => {
        let i = start;
        while (i < n) {
            const c = src[i];
            if (c === "\\") i += 2;
            else if (c === "`") {
                blank(start, i);
                return i;
            } else if (c === "$" && src[i + 1] === "{") {
                // Skip a balanced `${ … }`, itself able to hold strings,
                // templates and comments.
                let depth = 1;
                i += 2;
                while (i < n && depth > 0) {
                    const d = src[i];
                    if (d === "{") depth++;
                    else if (d === "}") depth--;
                    else if (d === '"' || d === "'") {
                        const end = quoted(i);
                        if (end < 0) return -1;
                        i = end;
                    } else if (d === "`") {
                        const end = template(i + 1);
                        if (end < 0) return -1;
                        i = end;
                    }
                    i++;
                }
            } else i++;
        }
        return -1;
    };
    // Single/double-quoted string opening at `i`; returns the closing quote.
    const quoted = (i: number): number => {
        const q = src[i];
        let j = i + 1;
        while (j < n && src[j] !== q) {
            if (src[j] === "\\") j++;
            if (src[j] === "\n") return -1;
            j++;
        }
        if (j >= n) return -1;
        blank(i + 1, j);
        return j;
    };
    let i = 0;
    while (i < n) {
        const c = src[i];
        const next = src[i + 1];
        if (c === "/" && next === "/") {
            const end = src.indexOf("\n", i);
            const stop = end < 0 ? n : end;
            blank(i, stop);
            i = stop;
        } else if (c === "/" && next === "*") {
            const end = src.indexOf("*/", i + 2);
            if (end < 0) return null;
            blank(i, end + 2);
            i = end + 2;
        } else if (c === '"' || c === "'") {
            const end = quoted(i);
            if (end < 0) return null;
            i = end + 1;
        } else if (c === "`") {
            const end = template(i + 1);
            if (end < 0) return null;
            i = end + 1;
        } else i++;
    }
    return { masked: out.join("") };
}

/** Parse a registry source; `null` when it cannot be read with confidence. */
export function parseRegistryEntries(source: string): RegistryEntries | null {
    const m = mask(source);
    if (m === null) return null;
    const { masked } = m;
    const head = ARRAY_HEAD.exec(masked);
    if (head === null) return null;
    const arrayStart = head.index + head[0].length;

    // Top-level element ranges of the array: split on depth-0 commas.
    const ranges: Array<[number, number]> = [];
    let depth = 0;
    let from = arrayStart;
    let arrayEnd = -1;
    for (let i = arrayStart; i < masked.length; i++) {
        const c = masked[i];
        if (c === "{" || c === "[" || c === "(") depth++;
        else if (c === "}" || c === ")") depth--;
        else if (c === "]") {
            if (depth === 0) {
                ranges.push([from, i]);
                arrayEnd = i;
                break;
            }
            depth--;
        } else if (c === "," && depth === 0) {
            ranges.push([from, i]);
            from = i + 1;
        }
        if (depth < 0) return null;
    }
    if (arrayEnd < 0) return null;

    const blocks = new Map<string, string>();
    let residue = "";
    let cursor = 0;
    // An element is cut out WHOLE — leading comments and the separating comma
    // included — so adding or removing an entry leaves the residue as it was.
    for (const [a, b] of ranges) {
        const maskedEl = masked.slice(a, b);
        const open = maskedEl.indexOf("{");
        const close = maskedEl.lastIndexOf("}");
        const onlyBlank = (s: string) => /^\s*$/.test(s);
        const consumed = masked[b] === "," ? b + 1 : b;
        // The empty element after a trailing comma carries nothing.
        if (onlyBlank(maskedEl)) {
            residue += source.slice(cursor, a);
            cursor = consumed;
            continue;
        }
        // Not a plain `{ … }` element (spread, call, generated): residue.
        if (
            open < 0 ||
            close < open ||
            !onlyBlank(maskedEl.slice(0, open)) ||
            !onlyBlank(maskedEl.slice(close + 1))
        )
            continue;
        const label = labelAtDepthOne(source, masked, a + open, a + close);
        if (label === null || blocks.has(label)) continue;
        blocks.set(label, source.slice(a, b).trim());
        residue += source.slice(cursor, a);
        cursor = consumed;
    }
    residue += source.slice(cursor);
    return { blocks, residue };
}

/** The literal `label: "…"` of the object spanning `[open, close]`, found at
 *  depth 1 only (a nested object's own `label` is not the entry's). */
function labelAtDepthOne(
    source: string,
    masked: string,
    open: number,
    close: number
): string | null {
    let depth = 0;
    for (let i = open; i <= close; i++) {
        const c = masked[i];
        if (c === "{" || c === "[" || c === "(") depth++;
        else if (c === "}" || c === "]" || c === ")") depth--;
        else if (depth === 1 && masked.startsWith("label", i)) {
            const before = masked[i - 1];
            const rest = /^label\s*:\s*(["'])/.exec(masked.slice(i, i + 40));
            if (rest === null || !/[\s{,]/.test(before)) continue;
            const quoteAt = i + rest[0].length - 1;
            const q = source[quoteAt];
            let j = quoteAt + 1;
            while (j < close && source[j] !== q)
                j += source[j] === "\\" ? 2 : 1;
            return source.slice(quoteAt + 1, j);
        }
    }
    return null;
}

/** The `tier` of an entry block, `null` when not a literal. Read at depth 1
 *  of the masked block, like the label: a comment or a nested object naming
 *  `tier: "stretch"` is not the entry's tier. */
export function entryTier(block: string): "must" | "stretch" | null {
    const m = mask(block);
    if (m === null) return null;
    let depth = 0;
    for (let i = 0; i < m.masked.length; i++) {
        const c = m.masked[i];
        if (c === "{" || c === "[" || c === "(") depth++;
        else if (c === "}" || c === "]" || c === ")") depth--;
        else if (
            depth === 1 &&
            /[\s{,]/.test(m.masked[i - 1] ?? " ") &&
            m.masked.startsWith("tier", i)
        ) {
            const t = /^tier\s*:\s*(["'])/.exec(m.masked.slice(i, i + 20));
            if (t === null) continue;
            const at = i + t[0].length;
            const word = block.slice(at, block.indexOf(t[1], at));
            return word === "must" || word === "stretch" ? word : null;
        }
    }
    return null;
}

export type RegistryChange =
    /** Only literal entries differ: these `must` labels were added or changed. */
    | { kind: "entries"; labels: string[] }
    /** The residue (helpers, constants, generated entries) differs, or a
     *  revision could not be parsed: not an entries-only change. */
    | { kind: "other"; why: string };

/**
 * What changed in the registry between `before` (the last GREEN tip's source,
 * `null` when the file did not exist there) and `after`.
 *
 * A retitle is a delete plus an add: the new label is listed, the old one is
 * not (an entry that is gone owes nothing). An entry whose tier moved
 * `stretch → must` is an add; `must → stretch` is not listed.
 */
export function registryChange(
    before: string | null,
    after: string
): RegistryChange {
    const b = before === null ? null : parseRegistryEntries(before);
    const a = parseRegistryEntries(after);
    if (a === null)
        return { kind: "other", why: "registry.ts could not be parsed" };
    if (b === null)
        return { kind: "other", why: "last-GREEN registry.ts not parseable" };
    if (a.residue !== b.residue)
        return {
            kind: "other",
            why: "registry.ts changed outside its entries",
        };
    const labels: string[] = [];
    for (const [label, block] of a.blocks) {
        if (entryTier(block) !== "must") continue;
        if (b.blocks.get(label) !== block) labels.push(label);
    }
    return { kind: "entries", labels };
}
