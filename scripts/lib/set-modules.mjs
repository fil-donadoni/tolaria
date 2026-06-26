/**
 * Colour-split set layout helpers (ADR 0043).
 *
 * Every set is a DIRECTORY `convex/cards/sets/<code>/`, not a single file:
 * seven colour modules (`white|blue|black|red|green|multicolor|colorless`) plus
 * an `index.ts` barrel that re-exports them. The registry consumes a set
 * unchanged via `import * as <code> from "./sets/<code>"`, which resolves to
 * `<code>/index.ts`.
 *
 * Both importers (`json-to-cards.mjs` set mode, `list-to-cards.mjs` list mode)
 * route every card into its colour module via {@link moduleForCost} and emit the
 * directory through {@link writeSetDirectory} / the barrel + headers below.
 *
 * Colour classification reuses the single source of truth `getColorsFromCost`
 * (`convex/cards/colors.ts`, CR 202.2) — it is NOT reinvented here. Because that
 * helper is TypeScript, these scripts run under `bun`, not `node`.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getColorsFromCost } from "../../convex/cards/colors.ts";

/** The seven colour modules every set directory contains, in canonical order. */
export const COLOUR_MODULES = [
    "white",
    "blue",
    "black",
    "red",
    "green",
    "multicolor",
    "colorless",
];

const COLOR_TO_MODULE = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};

/** The colour module a card belongs in, classified by the colour identity of
 *  its mana cost (CR 202.2): no coloured cost (lands / colourless artifacts) →
 *  `colorless`; exactly one colour → that colour's module; two or more → gold,
 *  `multicolor`. `manaCost` is the engine `ManaCost` shape both importers parse;
 *  `undefined` (no cost) classifies as colorless. */
export function moduleForCost(manaCost) {
    const colors = getColorsFromCost(manaCost);
    if (colors.length === 0) return "colorless";
    if (colors.length === 1) return COLOR_TO_MODULE[colors[0]];
    return "multicolor";
}

/** Header comment for a colour module. */
export function moduleHeader(code, module) {
    const CODE = code.toUpperCase();
    return [
        `// ${CODE} — ${module} cards, split by colour per ADR 0043. The registry's`,
        `// \`import * as ${code} from "./sets/${code}"\` resolves through ${code}/index.ts.`,
        `// Cards are classified by the colour identity of their mana cost (CR 202.2):`,
        `// lands and colourless artifacts (no coloured cost) live in colorless.ts.`,
    ].join("\n");
}

/** Source of the `index.ts` barrel re-exporting all seven colour modules. */
export function barrelSource(code) {
    return [
        `// ${code.toUpperCase()} set barrel — re-exports every colour module so the`,
        `// registry's \`import * as ${code} from "./sets/${code}"\` resolves here`,
        `// unchanged (ADR 0043).`,
        "",
        ...COLOUR_MODULES.map((m) => `export * from "./${m}";`),
        "",
    ].join("\n");
}

/**
 * Writes a complete set directory `<setsDir>/<code>/`: one file per colour
 * module plus the `index.ts` barrel. `sources` maps a module name to an array
 * of card-definition source strings (already formatted). A module with no cards
 * is still emitted as `header + export {}` so every set has the same sparse
 * shape (ADR 0043). `importLine` is the shared `import type { … }` prepended to
 * any non-empty module.
 *
 * @returns the absolute path of the written set directory.
 */
export function writeSetDirectory(setsDir, code, sources, importLine) {
    const setDir = resolve(setsDir, code);
    mkdirSync(setDir, { recursive: true });

    for (const module of COLOUR_MODULES) {
        const cards = sources[module] ?? [];
        const header = moduleHeader(code, module);
        const body =
            cards.length === 0
                ? `${header}\n\nexport {};\n`
                : `${header}\n${importLine}\n\n${cards.join("\n\n")}\n`;
        writeFileSync(resolve(setDir, `${module}.ts`), body, "utf-8");
    }

    writeFileSync(resolve(setDir, "index.ts"), barrelSource(code), "utf-8");
    return setDir;
}
