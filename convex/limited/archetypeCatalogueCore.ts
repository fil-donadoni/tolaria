// Archetype Catalogue — the PURE half (ADR 0072, ADR 0167, PRD #8772,
// issue #8892). The single list of Archetype rows every Pack Source scope
// draws from: a checked-in seed (`data/archetype-catalogue.json`) layered
// under an Admin-edited database table (`archetypeCatalogue`, the
// `ctx.db`-owning shell is the sibling `archetypeCatalogue.ts`).
//
// Why the vocabulary is closed at all: `botDrafter.ts`'s `archetypeFitTerm`
// groups picks by EXACT STRING EQUALITY on these ids, so a free-text
// vocabulary silently forks into `reanimator`, `reanimate` and
// `graveyard-reanimator` — three plans to the scorer and one to a human.
// What the catalogue adds over a closed code list is that a row can be added
// from the editor without a code change, and that every row carries its own
// rubric: a `TAG WHEN:` / `NOT:` description naming the sibling a near-miss
// card belongs to, a two-line gloss and an example card. A row without both
// clauses is refused (`archetypeRowErrors`): two neighbouring rows
// (`graveyard` vs `reanimator`, `combo` vs `storm`) drift into each other
// card by card when only one side of their boundary was ever written.
//
// Validation has the two layers of ADR 0167: the seed guard checks checked-in
// Card Archetype files against the catalogue SEED (CI stays offline), the
// Admin write boundary checks a database write against seed ∪ DB.
//
// Rows carry no scope. A row is "in" a scope exactly when a Card Archetype of
// that scope carries it (`activeRows`), and its colours there are COMPUTED
// from the cards so tagged (`colourSignature`), never authored.
//
// Pure — no `ctx`, no `../_generated/server`, no `../auth` — so the browser
// (the Admin picker, the Draft Lab, ADR 0074) imports it safely.
import type { Color } from "../cards/types";
import { catalogueIdByName } from "../cards";
import { COLORED_MANA_COLORS } from "../gre/manaColors";
import catalogueSeedJson from "../../data/archetype-catalogue.json";

/** A row's short rubric — one line for when to tag, one for when not. */
export interface ArchetypeGloss {
    when: string;
    not: string;
}

/** One Archetype Catalogue row — the shape the seed file and the
 *  `archetypeCatalogue` table share. `id` is the exact string a Card
 *  Archetype row's `archetypes` array carries: kebab-case, lowercase, so a
 *  `normalizeArchetypes` output is looked up directly. `example` names a
 *  card. */
export interface ArchetypeCatalogueRow {
    id: string;
    description: string;
    gloss: ArchetypeGloss;
    example: string;
}

/** The checked-in catalogue seed file. */
export interface ArchetypeCatalogueFile {
    rows: ArchetypeCatalogueRow[];
}

/** The checked-in catalogue seed — alphabetical by `id`. */
export const ARCHETYPE_CATALOGUE_SEED: readonly ArchetypeCatalogueRow[] = (
    catalogueSeedJson as ArchetypeCatalogueFile
).rows;

/** Every SEED row id — the vocabulary the offline seed guard reads. */
export const ARCHETYPE_CATALOGUE_SEED_IDS: ReadonlySet<string> = new Set(
    ARCHETYPE_CATALOGUE_SEED.map((row) => row.id)
);

/** Lowercase kebab-case: words of `[a-z0-9]` joined by single hyphens,
 *  starting with a letter. */
const ARCHETYPE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const TAG_WHEN = "TAG WHEN:";
const NOT = "NOT:";

/** Every reason ONE catalogue row is malformed, or `[]` — the single
 *  authority the seed guard and the Admin create/edit mutations share:
 *
 *   - `id` lowercase kebab-case;
 *   - `description` carries a non-empty `TAG WHEN:` clause followed by a
 *     non-empty `NOT:` clause;
 *   - `gloss.when` / `gloss.not` each one non-empty line;
 *   - `example` names a real card. */
export function archetypeRowErrors(row: ArchetypeCatalogueRow): string[] {
    const errors: string[] = [];
    const label = `Archetype "${row.id}"`;
    if (!ARCHETYPE_ID_PATTERN.test(row.id)) {
        errors.push(`${label}: id must be lowercase kebab-case`);
    }
    const tagAt = row.description.indexOf(TAG_WHEN);
    const notAt = row.description.indexOf(NOT, tagAt + TAG_WHEN.length);
    if (tagAt === -1) {
        errors.push(`${label}: description has no "${TAG_WHEN}" clause`);
    } else if (notAt === -1) {
        errors.push(`${label}: description has no "${NOT}" clause`);
    } else {
        const tagClause = row.description.slice(tagAt + TAG_WHEN.length, notAt);
        const notClause = row.description.slice(notAt + NOT.length);
        if (tagClause.trim() === "") {
            errors.push(`${label}: the "${TAG_WHEN}" clause is empty`);
        }
        if (notClause.trim() === "") {
            errors.push(`${label}: the "${NOT}" clause is empty`);
        }
    }
    for (const [half, line] of Object.entries(row.gloss)) {
        if (line.trim() === "" || line.includes("\n")) {
            errors.push(`${label}: gloss.${half} must be one non-empty line`);
        }
    }
    if (catalogueIdByName(row.example) === null) {
        errors.push(`${label}: example "${row.example}" is not a card`);
    }
    return errors;
}

/** The effective catalogue: the seed with each DB row layered over it — a DB
 *  row whose `id` is a seed row's REPLACES it (an Admin edit), any other is
 *  added (an Admin create). Alphabetical by `id`: the picker renders this
 *  verbatim, and a reviewer scanning it hundreds of times wants a stable,
 *  guessable order. */
export function mergeArchetypeCatalogue(
    seed: readonly ArchetypeCatalogueRow[],
    db: readonly ArchetypeCatalogueRow[]
): ArchetypeCatalogueRow[] {
    const byId = new Map<string, ArchetypeCatalogueRow>();
    for (const row of seed) byId.set(row.id, row);
    for (const row of db) byId.set(row.id, row);
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The id set of a catalogue — what the Card Archetype validators check
 *  membership against. */
export function catalogueIds(
    catalogue: readonly ArchetypeCatalogueRow[]
): ReadonlySet<string> {
    return new Set(catalogue.map((row) => row.id));
}

/** Every reason an Admin create or edit of `row` must be refused, against
 *  the effective catalogue (seed ∪ DB): the row's own shape, plus — a
 *  create — an `id` already taken, or — an edit — an `id` no row has (an
 *  edit never renames: Card Archetypes reference the id). */
export function archetypeCatalogueWriteErrors(
    mode: "create" | "edit",
    row: ArchetypeCatalogueRow,
    catalogue: readonly ArchetypeCatalogueRow[]
): string[] {
    const errors = archetypeRowErrors(row);
    const exists = catalogue.some((existing) => existing.id === row.id);
    if (mode === "create" && exists) {
        errors.push(`Archetype "${row.id}" already exists`);
    }
    if (mode === "edit" && !exists) {
        errors.push(`Archetype "${row.id}" does not exist`);
    }
    return errors;
}

// ─────────────────────────────────────────────────────────────────────────
// A scope's view of the catalogue — emergent, never configured.
// ─────────────────────────────────────────────────────────────────────────

/** One card of a scope as the catalogue reads it: its Card Archetypes there
 *  and its colour identity (`getCardColorIdentity`). */
export interface ArchetypeScopeCard {
    archetypes: readonly string[];
    colours: readonly Color[];
}

/** The five colours of a colour signature. Colourless is no colour. */
export type SignatureColour = (typeof COLORED_MANA_COLORS)[number];

/** A row's colours in one scope: each colour's share of the row's tagged
 *  cards, summing to 1 — or all 0 when no tagged card has a colour. */
export type ColourSignature = Record<SignatureColour, number>;

/** The catalogue rows `scope` uses — those at least one of its cards
 *  carries — in catalogue order. No per-scope allowlist: a row no card of
 *  the scope tags is absent, and costs nothing. */
export function activeRows(
    scope: readonly ArchetypeScopeCard[],
    catalogue: readonly ArchetypeCatalogueRow[]
): ArchetypeCatalogueRow[] {
    const used = new Set(scope.flatMap((card) => card.archetypes));
    return catalogue.filter((row) => used.has(row.id));
}

/** Row `rowId`'s colour signature in `scope`, computed from the colour
 *  identity of the cards tagged with it there: each coloured card weighs 1,
 *  split evenly across its colours (a multicolour card counts partly toward
 *  each), a colourless card weighs nothing; the totals are then normalized
 *  to shares. Never authored — `aggro` reads RG in one scope and WR in
 *  another. */
export function colourSignature(
    scope: readonly ArchetypeScopeCard[],
    rowId: string
): ColourSignature {
    const weights = Object.fromEntries(
        COLORED_MANA_COLORS.map((colour) => [colour, 0])
    ) as ColourSignature;
    let total = 0;
    for (const card of scope) {
        if (!card.archetypes.includes(rowId)) continue;
        const colours = COLORED_MANA_COLORS.filter((colour) =>
            card.colours.includes(colour)
        );
        for (const colour of colours) {
            weights[colour] += 1 / colours.length;
        }
        if (colours.length > 0) total += 1;
    }
    if (total === 0) return weights;
    for (const colour of COLORED_MANA_COLORS) weights[colour] /= total;
    return weights;
}
