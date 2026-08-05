/**
 * Shared printed-mana-cost parser/formatter (issue #1742).
 *
 * Both importers (`json-to-cards.mjs` set mode, `list-to-cards.mjs` list mode)
 * parse the same Scryfall/MTGJSON `{1}{U}{U}`-style symbol string into the
 * engine's `ManaCost` shape (`convex/cards/types.ts`) and serialize it back
 * into TypeScript source for a generated `CardDefinition`. Extracted here
 * because the two importers used to keep independent copies that silently
 * dropped anything beyond digits/`X`/a bare colour (hybrid, Phyrexian) — the
 * exact bug that shipped Figure of Destiny as a costless 1/1 and misfiled
 * Vibrance into `colorless.ts`. One parser, fixed once, shared by both.
 */

// The five coloured mana symbols a guild-hybrid / Phyrexian pip can name (CR
// 202.1a / 107.4e/f). Colourless `{C}` is a plain pip (handled below) — no
// real guild-hybrid or Phyrexian symbol has ever been printed against it.
const HYBRID_COLORS = ["W", "U", "B", "R", "G"];
const HYBRID_RE = new RegExp(
    `^([${HYBRID_COLORS.join("")}])/([${HYBRID_COLORS.join("")}])$`
);
const PHYREXIAN_RE = new RegExp(`^([${HYBRID_COLORS.join("")}])/P$`);

const COLOR_SET = new Set(["W", "U", "B", "R", "G", "C"]);

/** Canonical field order used both when reading a plain colour pip and when
 *  emitting the generated `manaCost: { ... }` object literal. */
const COLOR_ORDER = ["X", "generic", "W", "U", "B", "R", "G", "C"];

/** Classifies one printed mana symbol (braces already stripped). Never
 *  silently drops an unrecognised symbol (issue #1742) — throws instead, so
 *  an importer run surfaces the gap as a loud failure rather than shipping an
 *  underpriced card. Monocolour hybrid (`{2/W}`), Phyrexian-hybrid
 *  (`{G/U/P}`) and snow (`{S}`) are genuinely unmodelled by `ManaCost`
 *  (PRD #1736 non-goals) and hit this same throw path. */
function classifySymbol(inner) {
    if (/^\d+$/.test(inner)) return { kind: "generic", n: Number(inner) };
    if (inner === "X") return { kind: "x" };
    if (COLOR_SET.has(inner)) return { kind: "color", color: inner };

    const hybrid = HYBRID_RE.exec(inner);
    if (hybrid) return { kind: "hybrid", colors: [hybrid[1], hybrid[2]] };

    const phyrexian = PHYREXIAN_RE.exec(inner);
    if (phyrexian) return { kind: "phyrexian", color: phyrexian[1] };

    throw new Error(
        `parseManaCost: unrecognised mana symbol "{${inner}}" — not a digit, ` +
            `X, colour, guild-hybrid ({R/W}), or Phyrexian ({B/P}) pip. Extend ` +
            `the parser (or ManaCost) before importing this card — never drop ` +
            `it silently (issue #1742).`
    );
}

/** Scryfall/MTGJSON `{1}{G}{B/P}`-style mana string → engine `ManaCost`
 *  (`convex/cards/types.ts`). Plain generic pips fold into `X` (a bare number
 *  when there is no `{X}` symbol, `"X".repeat(n)` when there is — the
 *  importers' existing convention). When a cost carries BOTH a variable `{X}`
 *  AND a fixed printed generic — Soul Burn `{X}{2}{B}`, Jacked Rabbit
 *  `{X}{1}{W}` — the `X` field holds the variable marker and the fixed
 *  portion goes into the distinct `ManaCost.generic` field instead of being
 *  dropped (issue #1774; #1742 fixed the same silent-cheaper-cost defect for
 *  hybrid/Phyrexian pips). Guild-hybrid pips accumulate into `hybrid` (one
 *  array entry per pip, printed-order colours: `{R/W}` → `["R","W"]`).
 *  Phyrexian pips accumulate into `phyrexian` (a per-colour count map:
 *  `{B/P}{B/P}` → `{ B: 2 }`). Throws on any symbol it cannot classify —
 *  see {@link classifySymbol}. */
export function parseManaCost(mana) {
    if (!mana) return undefined;

    const cost = {};
    let genericNum = 0;
    let xCount = 0;
    const hybridPips = [];
    let phyrexianPips;

    for (const sym of mana.match(/\{[^}]+\}/g) ?? []) {
        const parsed = classifySymbol(sym.slice(1, -1));
        switch (parsed.kind) {
            case "generic":
                genericNum += parsed.n;
                break;
            case "x":
                xCount++;
                break;
            case "color":
                cost[parsed.color] = (cost[parsed.color] ?? 0) + 1;
                break;
            case "hybrid":
                hybridPips.push(parsed.colors);
                break;
            case "phyrexian":
                phyrexianPips ??= {};
                phyrexianPips[parsed.color] =
                    (phyrexianPips[parsed.color] ?? 0) + 1;
                break;
        }
    }

    if (xCount > 0) {
        // Variable `{X}` and fixed printed generic are NOT mutually exclusive
        // (Soul Burn `{X}{2}{B}`, Jacked Rabbit `{X}{1}{W}`, issue #1774) — the
        // `X` field holds the variable marker, the coexisting fixed portion
        // goes into `ManaCost.generic` rather than being silently dropped.
        cost.X = "X".repeat(xCount);
        if (genericNum > 0) cost.generic = genericNum;
    } else if (genericNum > 0) {
        cost.X = genericNum;
    }
    if (hybridPips.length > 0) cost.hybrid = hybridPips;
    if (phyrexianPips) cost.phyrexian = phyrexianPips;

    return Object.keys(cost).length > 0 ? cost : undefined;
}

/** Serializes an engine `ManaCost` back into a TypeScript object-literal
 *  source fragment for a generated `CardDefinition`, e.g.
 *  `{ X: 1, phyrexian: { B: 2 } }`. Mirrors {@link parseManaCost}'s field set
 *  — must stay in sync so a parsed hybrid/Phyrexian cost round-trips into the
 *  emitted source instead of being computed and then dropped again at the
 *  emit step. */
export function formatManaCost(cost) {
    if (!cost) return "{}";
    const parts = [];
    for (const k of COLOR_ORDER) {
        if (cost[k] === undefined) continue;
        const val = typeof cost[k] === "string" ? `"${cost[k]}"` : cost[k];
        parts.push(`${k}: ${val}`);
    }
    if (cost.phyrexian && Object.keys(cost.phyrexian).length > 0) {
        const entries = COLOR_ORDER.filter(
            (k) => cost.phyrexian[k] !== undefined
        ).map((k) => `${k}: ${cost.phyrexian[k]}`);
        parts.push(`phyrexian: { ${entries.join(", ")} }`);
    }
    if (cost.hybrid && cost.hybrid.length > 0) {
        const pairs = cost.hybrid.map(([a, b]) => `["${a}", "${b}"]`);
        parts.push(`hybrid: [${pairs.join(", ")}]`);
    }
    return `{ ${parts.join(", ")} }`;
}
