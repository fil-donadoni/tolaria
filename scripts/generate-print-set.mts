#!/usr/bin/env npx tsx
/**
 * Generates a REPRINT-ONLY set — colour-split modules under
 * `convex/cards/sets/<code>/` (ADR 0043) that are entirely `CardPrint` rows.
 *
 * A reprint set (Revised, Fourth Edition, …) introduces no new cards, so it
 * declares no `CardDefinition` at all: each row carries the per-edition
 * Scryfall UUID (`printId`) and resolves printId -> definitionId -> a shared
 * `CardDefinition` that already lives in an implemented set. See ADR 0014.
 *
 * The script reads the MTGJSON `<CODE>.json` set file and matches each card by
 * oracle name to its existing CardDefinition via the live catalogue registry
 * (`tryGetCardByName`) — the same resolver the engine uses, so the match is
 * authoritative (it handles factory-defined cards, const-id references and
 * Beta-original definitions that a regex scan would miss). Rows are partitioned
 * by the colour identity of the printed mana cost (CR 202.2): monocoloured
 * cards go to their colour module, multicoloured to multicolor.ts, lands and
 * artifacts to colorless.ts. Per-printing rarity comes from the MTGJSON entry.
 *
 * Excluded: ante cards (ADR 0010) — they carry no print row. Any card whose
 * CardDefinition is not yet implemented is skipped with a warning; its print
 * lands automatically once the definition exists.
 *
 * ONE generator, parametrized by set code — 3ED and 4ED had a near-duplicate
 * script each, which is how the two drifted (different home-set lists in their
 * headers for the same catalogue). The home-set list is no longer hand-written:
 * it is derived per run from the lockfile `data/card-index.json`.
 *
 * Usage:  npx tsx scripts/generate-print-set.mts <code>     # e.g. 3ed, 4ed
 * Output: convex/cards/sets/<code>/{white,blue,…,colorless}.ts + index.ts
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tryGetCardByName } from "../convex/cards/index.ts";

interface ReprintSet {
    /** Full set name, as it reads in the generated header. */
    name: string;
    /** MTGJSON snapshot, relative to the repo root. */
    jsonPath: string;
    /** Ante cards in this set — permanently out of scope (ADR 0010). */
    ante: string[];
    /** One extra sentence for the module header, when the set has a property
     *  worth stating at the top of every file it generates. */
    note?: string;
}

const REPRINT_SETS: Record<string, ReprintSet> = {
    "3ed": {
        name: "Revised Edition",
        jsonPath: "data/json/3ED.json",
        ante: ["Contract from Below", "Darkpact", "Demonic Attorney"],
        note:
            "Revised's English (3ed) art is hosted on Scryfall, so the printId " +
            "renders correctly with no foreign-set image problem.",
    },
    "4ed": {
        name: "Fourth Edition",
        jsonPath: "data/json/4ED.json",
        ante: ["Bronze Tablet", "Rebirth", "Tempest Efreet"],
        note: "4ED is the earliest Premodern-legal set (issue #980).",
    },
};

const BASIC_LANDS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

type Colour =
    | "white"
    | "blue"
    | "black"
    | "red"
    | "green"
    | "multicolor"
    | "colorless";

const COLOUR_ORDER: Colour[] = [
    "white",
    "blue",
    "black",
    "red",
    "green",
    "multicolor",
    "colorless",
];

const COLOUR_NAME: Record<string, Colour> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};

const COLOUR_LABEL: Record<Colour, string> = {
    white: "white",
    blue: "blue",
    black: "black",
    red: "red",
    green: "green",
    multicolor: "multicoloured",
    colorless: "colourless (lands, artifacts)",
};

interface MtgJsonCard {
    name: string;
    number: string;
    rarity?: string;
    colors?: string[];
    supertypes?: string[];
    identifiers: { scryfallId: string };
}

interface Row {
    ident: string;
    printId: string;
    definitionId: string;
    name: string;
    rarity: string;
    colour: Colour;
    isBasic: boolean;
}

/** camelCase export identifier from a card name, suffixed with the set code.
 *  "Air Elemental" -> airElemental4ed,
 *  "Circle of Protection: Black" -> circleOfProtectionBlack4ed. */
function exportName(name: string, suffixIndex: number, setCode: string): string {
    const cleaned = name
        .replace(/[':,.()/]/g, " ")
        .replace(/-/g, " ")
        .replace(/&/g, " and ");
    const parts = cleaned.split(/\s+/).filter(Boolean);
    let ident = parts
        .map((p, i) =>
            i === 0
                ? p.charAt(0).toLowerCase() + p.slice(1)
                : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
        )
        .join("");
    if (/^[0-9]/.test(ident)) ident = "_" + ident;
    return `${ident}${suffixIndex > 1 ? suffixIndex : ""}${setCode}`;
}

/** Colour identity from printed mana cost colours (CR 202.2). */
function colourOf(c: MtgJsonCard): Colour {
    const cols = c.colors ?? [];
    if (cols.length === 0) return "colorless";
    if (cols.length >= 2) return "multicolor";
    return COLOUR_NAME[cols[0]] ?? "colorless";
}

/** Home sets the generated prints resolve INTO, read off the lockfile
 *  (`data/card-index.json`, ADR 0041) rather than hand-maintained in a header
 *  that nothing checks. Empty when the lockfile is missing — the header then
 *  simply omits the list instead of asserting a stale one. */
function homeSets(rows: Row[]): string[] {
    const lockPath = resolve("data/card-index.json");
    if (!existsSync(lockPath)) return [];
    const lock: { scryfallId: string; firstSet?: string }[] = JSON.parse(
        readFileSync(lockPath, "utf-8")
    );
    const setById = new Map(lock.map((e) => [e.scryfallId, e.firstSet]));
    const sets = new Set<string>();
    for (const r of rows) {
        const s = setById.get(r.definitionId);
        if (s) sets.add(s.toLowerCase());
    }
    return [...sets].sort();
}

function moduleHeader(
    code: string,
    set: ReprintSet,
    colour: Colour,
    sets: string[]
): string {
    const resolvesInto = sets.length
        ? `// already implemented in ${sets.join("/")}. See ADR 0014.\n`
        : `// already implemented elsewhere. See ADR 0014.\n`;
    const note = set.note ? `// ${set.note}\n` : "";
    return `import type { CardPrint } from "../../types";

// ${code.toUpperCase()} (${set.name}) ${COLOUR_LABEL[colour]} cards, split by colour per ADR 0043.
//
// ${set.name} is a 100% reprint set — it introduces no new cards — so this
// module is entirely CardPrint entries: each declares the per-edition Scryfall
// UUID (printId) and resolves printId -> definitionId -> a shared CardDefinition
${resolvesInto}${note}//
// Generated by scripts/generate-print-set.mts ${code} from ${set.jsonPath}
// (name -> definitionId match via the live registry, printId + rarity from the
// ${code.toUpperCase()} Scryfall entry). Re-run that script to regenerate.
//
// Excluded: ante cards — ${set.ante.join(", ")} — are permanently out of
// scope (ADR 0010) and carry no print row. Cards whose CardDefinition is not
// yet implemented are omitted; each lands automatically once its definition
// exists.
`;
}

function emit(r: Row, code: string): string {
    return `export const ${r.ident}: CardPrint = {
    printId: "${r.printId}",
    definitionId: "${r.definitionId}", // ${r.name}
    setCode: "${code}",
    rarity: "${r.rarity}",
};
`;
}

function main(): void {
    const code = (process.argv[2] ?? "").toLowerCase();
    const set = REPRINT_SETS[code];
    if (!set) {
        console.error(
            `Usage: npx tsx scripts/generate-print-set.mts <code>\n` +
                `  known reprint sets: ${Object.keys(REPRINT_SETS).join(", ")}\n` +
                `  a new one is a row in REPRINT_SETS (name, jsonPath, ante), not a new script.`
        );
        process.exit(1);
    }
    const outDir = `convex/cards/sets/${code}`;

    const raw = JSON.parse(readFileSync(resolve(set.jsonPath), "utf-8"));
    const cards: MtgJsonCard[] = raw.data.cards;
    const ante = new Set(set.ante);
    const numOf = (c: MtgJsonCard) => parseInt(c.number, 10) || 0;

    const nonBasic = cards
        .filter((c) => !c.supertypes?.includes("Basic"))
        .sort((a, b) => numOf(a) - numOf(b));
    const basics = cards
        .filter((c) => c.supertypes?.includes("Basic"))
        .sort((a, b) => numOf(a) - numOf(b));

    const skipped: string[] = [];
    const seen = new Map<string, number>();
    const rows: Row[] = [];

    const makeRow = (c: MtgJsonCard, isBasic: boolean): Row => {
        const count = (seen.get(c.name) ?? 0) + 1;
        seen.set(c.name, count);
        return {
            ident: exportName(c.name, count, code),
            printId: c.identifiers.scryfallId,
            definitionId: tryGetCardByName(c.name)!.id,
            name: c.name,
            rarity: c.rarity ?? "common",
            colour: isBasic ? "colorless" : colourOf(c),
            isBasic,
        };
    };

    for (const c of nonBasic) {
        if (ante.has(c.name)) continue; // ADR 0010
        if (!tryGetCardByName(c.name)) {
            skipped.push(c.name);
            continue;
        }
        rows.push(makeRow(c, false));
    }
    for (const c of basics) {
        if (!BASIC_LANDS.includes(c.name)) continue;
        if (!tryGetCardByName(c.name)) {
            skipped.push(c.name);
            continue;
        }
        rows.push(makeRow(c, true));
    }

    mkdirSync(resolve(outDir), { recursive: true });
    const sets = homeSets(rows);

    const nonEmpty: Colour[] = [];
    for (const colour of COLOUR_ORDER) {
        const colourRows = rows.filter(
            (r) => r.colour === colour && !r.isBasic
        );
        const basicRows =
            colour === "colorless" ? rows.filter((r) => r.isBasic) : [];
        if (colourRows.length === 0 && basicRows.length === 0) continue;
        nonEmpty.push(colour);

        let body = colourRows.map((r) => emit(r, code)).join("\n");
        if (basicRows.length) {
            body +=
                "\n// Basic lands (art variants — one print per collector number).\n\n" +
                basicRows.map((r) => emit(r, code)).join("\n");
        }
        writeFileSync(
            resolve(outDir, `${colour}.ts`),
            moduleHeader(code, set, colour, sets) + "\n" + body
        );
    }

    const barrel = `// ${code.toUpperCase()} set barrel — re-exports every colour module so the registry's
// \`import * from "./sets/${code}"\` resolves here unchanged (ADR 0043).
// ${set.name} is a reprint-only set; only the colour modules with CardPrint
// entries exist.
//
// Generated by scripts/generate-print-set.mts ${code} — re-run to regenerate.

${nonEmpty.map((c) => `export * from "./${c}";`).join("\n")}
`;
    writeFileSync(resolve(outDir, "index.ts"), barrel);

    console.log(
        `✓ wrote ${outDir}/: ${rows.length} prints across ${nonEmpty.length} colour module(s) [${nonEmpty.join(", ")}]`
    );
    console.log(`  ante exclusions (ADR 0010): ${set.ante.join(", ")}`);
    if (skipped.length) {
        console.warn(
            `  ⚠ ${skipped.length} card(s) skipped (no CardDefinition yet):\n    ` +
                skipped.sort().join("\n    ")
        );
    }
}

main();
