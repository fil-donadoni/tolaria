// Card Profile seed-file export and promote — the PURE half (PRD #8772, issue
// #8907). The production review becomes git history in two steps:
//
//   1. **Export** (`exportCardProfileSeedFile`, `cardProfiles.ts`): one
//      layer's EFFECTIVE rows — a database row over its seed row, the seed
//      row where the database has none — written in the layer's checked-in
//      seed-file format (`capabilities.json` / `archetypes/<scope>.json`),
//      review flags and rationales included.
//   2. **Promote** (`bun run profiles:promote <file>`,
//      `scripts/profiles-promote.ts`): the exported file is parsed against
//      the seed-file SCHEMA here, then checked by the SAME validators the
//      seed guards run in CI (`validateCardCapabilityFile` /
//      `validateCardArchetypeFile`: registry, catalogue, card ids), and only
//      then replaces the matching seed file.
//
// Pure — no `ctx`, no filesystem — so the Convex query, the promote CLI and
// the tests share one definition of "a seed file".
import {
    archetypesOf,
    capabilitiesOf,
    getCardArchetypeFile,
    validateCardArchetypeFile,
    validateCardCapabilityFile,
    type CardArchetypeFile,
    type CardArchetypes,
    type CardCapabilities,
    type CardCapabilitiesRow,
    type CardCapabilityFile,
    type ScopedCardArchetypes,
} from "./cardProfilesCore";

/** The two Card Profile layers (ADR 0167), as the Admin tool's tabs name them. */
export type CardProfileLayer = "capabilities" | "archetypes";

export const CARD_PROFILE_LAYERS: readonly CardProfileLayer[] = [
    "capabilities",
    "archetypes",
];

/** A parsed seed file, tagged with the layer its shape belongs to. */
export type CardProfileSeedFile =
    | { layer: "capabilities"; file: CardCapabilityFile }
    | { layer: "archetypes"; file: CardArchetypeFile };

/** The seed file's path relative to the repository root. */
export function seedFilePath(seed: CardProfileSeedFile): string {
    return seed.layer === "capabilities"
        ? "data/card-profiles/capabilities.json"
        : `data/card-profiles/archetypes/${seed.file.scope}.json`;
}

/** The file name an export downloads as — the seed file's own basename, so
 *  `profiles:promote` needs no rename. */
export function seedFileName(seed: CardProfileSeedFile): string {
    const path = seedFilePath(seed);
    return path.slice(path.lastIndexOf("/") + 1);
}

/** Overlays `dbRows` on `seedRows`: the seed's key order kept (a promote
 *  diffs only the rows a human changed), a DB row replacing its seed row,
 *  a DB-only row appended in `cardId` order. */
function overlay<T>(
    seedRows: Record<string, T>,
    dbRows: ReadonlyArray<{ cardId: string; row: T }>
): Record<string, T> {
    const db = new Map(dbRows.map(({ cardId, row }) => [cardId, row]));
    const out: Record<string, T> = {};
    for (const [cardId, row] of Object.entries(seedRows)) {
        out[cardId] = db.get(cardId) ?? row;
    }
    const added = [...db.keys()]
        .filter((cardId) => !(cardId in seedRows))
        .sort();
    for (const cardId of added) out[cardId] = db.get(cardId) as T;
    return out;
}

/** The Capability layer's effective rows in seed-file format: every seed
 *  row, each replaced by its `cardCapabilities` override when one exists,
 *  plus every override with no seed row. Row fields in the seed's order. */
export function buildCapabilityExportFile(
    seed: CardCapabilityFile,
    dbRows: readonly CardCapabilitiesRow[]
): CardCapabilityFile {
    const seedRows: Record<string, CardCapabilities> = {};
    for (const [cardId, row] of Object.entries(seed.capabilities)) {
        seedRows[cardId] = capabilitiesOf({ cardId, ...row });
    }
    return {
        capabilities: overlay(
            seedRows,
            dbRows.map((row) => ({
                cardId: row.cardId,
                row: capabilitiesOf(row),
            }))
        ),
    };
}

/** One scope's Archetype layer effective rows in seed-file format: the
 *  scope's seed rows (none when it ships no seed file), each replaced by its
 *  `cardArchetypes` override, plus every override with no seed row. Only
 *  `scope`'s DB rows count (case-insensitive); the file's `scope` is
 *  lowercase, like every seed file's. */
export function buildArchetypeExportFile(
    scope: string,
    seed: CardArchetypeFile | null,
    dbRows: readonly ScopedCardArchetypes[]
): CardArchetypeFile {
    const normalizedScope = scope.toLowerCase();
    const seedRows: Record<string, CardArchetypes> = {};
    for (const [cardId, row] of Object.entries(seed?.archetypes ?? {})) {
        seedRows[cardId] = archetypesOf({
            scope: normalizedScope,
            cardId,
            ...row,
        });
    }
    return {
        scope: normalizedScope,
        archetypes: overlay(
            seedRows,
            dbRows
                .filter((row) => row.scope.toLowerCase() === normalizedScope)
                .map((row) => ({ cardId: row.cardId, row: archetypesOf(row) }))
        ),
    };
}

/** A seed file as the text an export downloads and a promote writes back:
 *  4-space JSON with a trailing newline (the promote CLI then hands it to
 *  prettier, so the checked-in bytes match `format:check`). */
export function serializeSeedFile(seed: CardProfileSeedFile): string {
    return `${JSON.stringify(seed.file, null, 4)}\n`;
}

// ─── Schema ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === "string")
    );
}

function unknownKeys(
    value: Record<string, unknown>,
    allowed: readonly string[]
): string[] {
    return Object.keys(value).filter((key) => !allowed.includes(key));
}

const CAPABILITY_ROW_KEYS = [
    "provides",
    "requires",
    "comboEdges",
    "reviewed",
    "rationale",
] as const;
const ARCHETYPE_ROW_KEYS = ["archetypes", "reviewed", "rationale"] as const;

/** Schema errors shared by both layers' rows: `reviewed` a boolean,
 *  `rationale` absent or a string, no field outside `allowed`. */
function commonRowErrors(
    where: string,
    row: Record<string, unknown>,
    allowed: readonly string[]
): string[] {
    const errors: string[] = [];
    for (const key of unknownKeys(row, allowed)) {
        errors.push(`${where}: unknown field "${key}"`);
    }
    if (typeof row.reviewed !== "boolean") {
        errors.push(`${where}: "reviewed" must be a boolean`);
    }
    if (row.rationale !== undefined && typeof row.rationale !== "string") {
        errors.push(`${where}: "rationale" must be a string`);
    }
    return errors;
}

function capabilityRowErrors(where: string, row: unknown): string[] {
    if (!isRecord(row)) return [`${where}: a row must be an object`];
    const errors = commonRowErrors(where, row, CAPABILITY_ROW_KEYS);
    for (const field of ["provides", "requires"] as const) {
        if (!isStringArray(row[field])) {
            errors.push(`${where}: "${field}" must be an array of strings`);
        }
    }
    if (row.comboEdges !== undefined) {
        const edges = row.comboEdges;
        const valid =
            Array.isArray(edges) &&
            edges.every(
                (edge) =>
                    isRecord(edge) &&
                    unknownKeys(edge, ["cardId", "weight"]).length === 0 &&
                    typeof edge.cardId === "string" &&
                    typeof edge.weight === "number"
            );
        if (!valid) {
            errors.push(
                `${where}: "comboEdges" must be an array of { cardId, weight }`
            );
        }
    }
    return errors;
}

function archetypeRowErrors(where: string, row: unknown): string[] {
    if (!isRecord(row)) return [`${where}: a row must be an object`];
    const errors = commonRowErrors(where, row, ARCHETYPE_ROW_KEYS);
    if (!isStringArray(row.archetypes)) {
        errors.push(`${where}: "archetypes" must be an array of strings`);
    }
    return errors;
}

/** Reads a JSON value as ONE layer's seed file, or every reason it is not
 *  one. The layer is told by the top-level shape: `{ capabilities }` is the
 *  Capability file, `{ scope, archetypes }` an Archetype file; any other
 *  shape — both, neither, a row of the other layer's shape — is refused. */
export function parseCardProfileSeedFile(
    json: unknown
): { ok: true; seed: CardProfileSeedFile } | { ok: false; errors: string[] } {
    if (!isRecord(json)) {
        return { ok: false, errors: ["a seed file must be a JSON object"] };
    }
    const keys = Object.keys(json).sort().join(",");
    if (keys === "capabilities") {
        if (!isRecord(json.capabilities)) {
            return { ok: false, errors: ['"capabilities" must be an object'] };
        }
        const errors = Object.entries(json.capabilities).flatMap(
            ([cardId, row]) =>
                capabilityRowErrors(`capabilities.${cardId}`, row)
        );
        return errors.length > 0
            ? { ok: false, errors }
            : {
                  ok: true,
                  seed: {
                      layer: "capabilities",
                      file: json as unknown as CardCapabilityFile,
                  },
              };
    }
    if (keys === "archetypes,scope") {
        const errors: string[] = [];
        if (typeof json.scope !== "string" || json.scope === "") {
            errors.push('"scope" must be a non-empty string');
        } else if (json.scope !== json.scope.toLowerCase()) {
            errors.push(`"scope" "${json.scope}" must be lowercase`);
        }
        if (!isRecord(json.archetypes)) {
            errors.push('"archetypes" must be an object');
        } else {
            for (const [cardId, row] of Object.entries(json.archetypes)) {
                errors.push(...archetypeRowErrors(`archetypes.${cardId}`, row));
            }
        }
        return errors.length > 0
            ? { ok: false, errors }
            : {
                  ok: true,
                  seed: {
                      layer: "archetypes",
                      file: json as unknown as CardArchetypeFile,
                  },
              };
    }
    return {
        ok: false,
        errors: [
            `top-level fields "${keys}" match no layer: a Capability file is { capabilities }, an Archetype file { scope, archetypes }`,
        ],
    };
}

/** Every reason `json` must not replace a checked-in seed file, or the
 *  parsed file when it may: the schema above, then the CI seed guards
 *  (Capability registry / catalogue seed / card ids), then — for an
 *  Archetype file — a scope that ships a checked-in seed file already (a new
 *  scope's file is loaded only once `CHECKED_IN_CARD_ARCHETYPES` names it,
 *  so promoting one would write a file nothing reads). Pure. */
export function checkPromotableSeedFile(
    json: unknown
): { ok: true; seed: CardProfileSeedFile } | { ok: false; errors: string[] } {
    const parsed = parseCardProfileSeedFile(json);
    if (!parsed.ok) return parsed;
    const { seed } = parsed;
    const errors =
        seed.layer === "capabilities"
            ? validateCardCapabilityFile(seed.file).errors
            : validateCardArchetypeFile(seed.file).errors;
    if (
        seed.layer === "archetypes" &&
        getCardArchetypeFile(seed.file.scope) === null
    ) {
        errors.push(
            `scope "${seed.file.scope}" ships no checked-in Archetype seed file — register one in CHECKED_IN_CARD_ARCHETYPES (cardProfilesCore.ts) first`
        );
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true, seed };
}
