/**
 * Catalogue of every token shape the card pool can create (CR 111 / 707.2).
 *
 * A token is NOT a card: it has no `CardDefinition` in the registry, so it is
 * unreachable by name through `getCardByName`. Its characteristics live in a
 * `TokenSpec` that only exists inside the producing card's effect — a DSL
 * `createToken` Op (ADR 0045) or a shared spec in `sharedTokens.ts`. That is
 * what stops a debug scenario from staging a board WITH tokens on it (issue:
 * "can't put a token on the battlefield in a scenario").
 *
 * This module derives that missing catalogue STATICALLY: it walks every
 * `createToken` Op on every card in the pool (through the four frozen
 * structural constructs plus `coinFlip` / `optionChoice` / `delayedTrigger`,
 * exactly like the art-completeness guard in
 * `__tests__/tokenPrintLookup.test.ts`), plus the shared token specs, resolves
 * each spec's art the same way `SpellContext.createToken` does at runtime, and
 * dedupes by the content-derived `tokenDefinitionId` so two producers of the
 * identical 1/1 white Soldier collapse to ONE catalogue entry.
 *
 * **Known blind spot:** a token created imperatively inside a `resolve()`
 * closure (`ctx.createToken({...})`) is invisible to a static walk — the spec
 * is built at runtime. Those shapes are reachable only if they ALSO exist as a
 * shared spec. Accepted: the DSL is the authoring default (ADR 0045), so the
 * catalogue covers the overwhelming majority and grows automatically as cards
 * migrate.
 */

import { getAllCards, tokenDefinitionId } from "./index";
import * as SHARED_TOKENS from "./sharedTokens";
import { tokenPrintIdFor } from "./tokenPrintLookup";
import type {
    CardDefinition,
    EffectOp,
    EffectTokenSpec,
    TokenSpec,
} from "./types";

/** One distinct token SHAPE the pool can create. */
export type TokenCatalogueEntry = {
    /** Unique, user-typeable key — what a scenario spec stores in
     *  `ScenarioCard.name` alongside `token: true`. The plain token name when
     *  that name identifies exactly one shape in the pool; otherwise the name
     *  plus a disambiguating suffix (see `tokenCatalogueKey`). */
    key: string;
    /** The token's display name (CR 707.2) — may repeat across entries. */
    name: string;
    /** The spec to hand to `createTokenPermanents`, art already resolved. */
    spec: TokenSpec;
    /** Content-derived definition id (`tokenDefinitionId`) — the identity this
     *  entry is deduped by. */
    defId: string;
    /** Name of a card that produces this token, for the editor's label. Empty
     *  for a shared spec with no DSL producer in the pool. */
    producedBy: string;
};

// ---- Static walk -----------------------------------------------------------

/** Recursively collect every `createToken` Op's spec out of an Op list,
 *  descending into every structural construct that can nest one (ADR 0045's
 *  four frozen constructs, plus the multi-branch Ops that reuse the same
 *  nested-list shape). Mirrors the walker in `tokenPrintLookup.test.ts`. */
function collectTokenSpecs(ops: EffectOp[]): EffectTokenSpec[] {
    const specs: EffectTokenSpec[] = [];
    for (const op of ops) {
        switch (op.op) {
            case "createToken":
                specs.push(op.token);
                break;
            case "if":
                specs.push(...collectTokenSpecs(op.then));
                if (op.else) specs.push(...collectTokenSpecs(op.else));
                break;
            case "forEach":
                specs.push(...collectTokenSpecs(op.effects));
                break;
            case "delayedTrigger":
                specs.push(...collectTokenSpecs(op.effects));
                break;
            case "coinFlip":
                specs.push(...collectTokenSpecs(op.win.effects));
                specs.push(...collectTokenSpecs(op.loss.effects));
                break;
            case "optionChoice":
                for (const mode of op.modes) {
                    specs.push(...collectTokenSpecs(mode.effects));
                }
                break;
            default:
                break;
        }
    }
    return specs;
}

/** Every `effects[]` site on a card that can carry a `createToken` Op. */
function allTokenSpecsFor(card: CardDefinition): EffectTokenSpec[] {
    const sites: (EffectOp[] | undefined)[] = [
        card.effects,
        ...(card.activatedAbilities ?? []).map((a) => a.effects),
        ...(card.triggeredAbilities ?? []).map((a) => a.effects),
        ...(card.grantTemplates ?? []).map((a) => a.effects),
        ...(card.triggeredGrantTemplates ?? []).map((a) => a.effects),
    ];
    return sites
        .filter((effects): effects is EffectOp[] => effects !== undefined)
        .flatMap(collectTokenSpecs);
}

// ---- Spec normalization ----------------------------------------------------

/** Turn a JSON-pure `EffectTokenSpec` into the `TokenSpec` the engine
 *  primitive takes, resolving art and collapsing `entersWith` counts.
 *
 *  `EffectTokenSpec.entersWith.counters[].count` is an `EffectValue` resolved
 *  at execution time against the script's bindings (`createToken` in
 *  `gre/effects/interpreter.ts`). A catalogue entry has no such runtime
 *  context, so only LITERAL counts survive — a dynamic count (Incubate N)
 *  degrades to "no entry counters", which is the right default for a staged
 *  debug board (the scenario's own `counters` field can set any amount). */
function toTokenSpec(
    spec: EffectTokenSpec,
    producerCardId: string | undefined
): TokenSpec {
    const { entersWith, backFace, ...rest } = spec;
    const counters = entersWith?.counters
        ?.map((c) =>
            typeof c.count === "number" && c.count > 0
                ? { type: c.type, count: c.count }
                : undefined
        )
        .filter((c): c is { type: string; count: number } => c !== undefined);
    return {
        ...rest,
        // CR 707.1 — art resolution mirrors `SpellContext.createToken`: an
        // explicit `imagePrintId` wins, else the build-time Scryfall
        // reverse-link keyed by (producing card id, token name).
        ...(spec.imagePrintId === undefined && producerCardId !== undefined
            ? { imagePrintId: tokenPrintIdFor(producerCardId, spec.name) }
            : {}),
        ...(counters && counters.length > 0
            ? { entersWith: { counters } }
            : {}),
        // CR 712 — the JSON-pure back face is structurally the `CardBackFace`
        // subset `TokenSpec` declares.
        ...(backFace ? { backFace: backFace as TokenSpec["backFace"] } : {}),
    };
}

// ---- Key derivation --------------------------------------------------------

/** A short, human-readable characteristics suffix used to disambiguate two
 *  token shapes that share a name (e.g. a 1/1 white Soldier vs a 1/1 black
 *  Soldier): `"Soldier (1/1 W)"`, `"Clue (Artifact)"`. Stable and derived
 *  purely from the spec, so a saved scenario key survives a rebuild. */
function characteristicsSuffix(spec: TokenSpec): string {
    const parts: string[] = [];
    if (spec.power !== undefined || spec.toughness !== undefined) {
        parts.push(`${spec.power ?? 0}/${spec.toughness ?? 0}`);
    }
    const colors = (spec.colors ?? []).join("");
    parts.push(colors === "" ? "C" : colors);
    if (spec.staticAbilities && spec.staticAbilities.length > 0) {
        parts.push(spec.staticAbilities.join(","));
    }
    if (spec.activatedAbilities && spec.activatedAbilities.length > 0) {
        parts.push("ability");
    }
    return parts.join(" ");
}

// ---- Catalogue -------------------------------------------------------------

type RawEntry = { spec: TokenSpec; defId: string; producedBy: string };

function collectRawEntries(): RawEntry[] {
    const byShape = new Map<string, RawEntry>();
    const add = (spec: TokenSpec, producedBy: string) => {
        // Dedupe by the shape's CHARACTERISTICS, i.e. the content-derived id
        // with the art segment stripped: the same 1/1 white Spirit created by
        // two different cards is ONE catalogue entry even though each carries
        // its own producer's printed art. Art is then upgraded in place, so
        // the surviving entry is the one that actually renders (a shared spec
        // with no `imagePrintId` loses to a producer whose Scryfall
        // reverse-link resolved one).
        const shapeKey = tokenDefinitionId({
            ...spec,
            imagePrintId: undefined,
        });
        const existing = byShape.get(shapeKey);
        if (!existing) {
            byShape.set(shapeKey, {
                spec,
                defId: tokenDefinitionId(spec),
                producedBy,
            });
            return;
        }
        if (
            existing.spec.imagePrintId === undefined &&
            spec.imagePrintId !== undefined
        ) {
            byShape.set(shapeKey, {
                spec,
                defId: tokenDefinitionId(spec),
                producedBy,
            });
        }
    };

    for (const card of getAllCards()) {
        for (const raw of allTokenSpecsFor(card)) {
            add(toTokenSpec(raw, card.id), card.name);
        }
    }
    // Shared specs (`sharedTokens.ts`) — included explicitly so a token whose
    // only producer is a `resolve()` closure (invisible to the static walk) is
    // still stageable, as long as it uses the shared spec.
    for (const value of Object.values(SHARED_TOKENS)) {
        if (isTokenSpecLike(value)) add(toTokenSpec(value, undefined), "");
    }

    return [...byShape.values()].sort(
        (a, b) =>
            a.spec.name.localeCompare(b.spec.name) ||
            a.defId.localeCompare(b.defId)
    );
}

/** Structural guard for the `sharedTokens` module scan — every export there is
 *  a token spec today, but the check keeps a future non-spec export (a helper,
 *  a constant) from being pulled into the catalogue. */
function isTokenSpecLike(value: unknown): value is EffectTokenSpec {
    if (typeof value !== "object" || value === null) return false;
    const v = value as { name?: unknown; types?: unknown };
    return typeof v.name === "string" && Array.isArray(v.types);
}

let cached: TokenCatalogueEntry[] | undefined;

/**
 * Every distinct token shape the pool can create, keyed uniquely and sorted by
 * name. Memoized: the walk is over the whole catalogue and the pool is static
 * for the life of the process.
 */
export function listTokenCatalogue(): TokenCatalogueEntry[] {
    if (cached) return cached;
    const raw = collectRawEntries();
    // A name that identifies exactly one shape stays a bare name (the common
    // case, and what a human types); a name shared by several shapes gets a
    // characteristics suffix so every shape stays reachable.
    const nameCounts = new Map<string, number>();
    for (const entry of raw) {
        nameCounts.set(
            entry.spec.name,
            (nameCounts.get(entry.spec.name) ?? 0) + 1
        );
    }
    const used = new Set<string>();
    cached = raw.map((entry) => {
        const bare = entry.spec.name;
        let key =
            (nameCounts.get(bare) ?? 0) > 1
                ? `${bare} (${characteristicsSuffix(entry.spec)})`
                : bare;
        // Last-resort uniqueness: two shapes sharing name AND characteristics
        // suffix (they differ only in a field the suffix doesn't show) get a
        // numeric tail, so `key` is ALWAYS unique across the catalogue.
        if (used.has(key)) {
            let n = 2;
            while (used.has(`${key} #${n}`)) n++;
            key = `${key} #${n}`;
        }
        used.add(key);
        return {
            key,
            name: bare,
            spec: entry.spec,
            defId: entry.defId,
            producedBy: entry.producedBy,
        };
    });
    return cached;
}

/** Every catalogue key, sorted — the autocomplete source for the debug
 *  scenario editor (the token counterpart of `getAllCardNames`). */
export function getAllTokenKeys(): string[] {
    return listTokenCatalogue().map((e) => e.key);
}

/**
 * Resolve a scenario's token reference to the spec to create. Matches the
 * unique catalogue key first (case-insensitive), then falls back to a bare
 * token NAME — so a spec authored as `{ name: "Treasure", token: true }` keeps
 * working even if a later card introduces a second "Treasure" shape and the
 * canonical key gains a suffix (the first shape by sort order wins). Returns
 * undefined when nothing matches; the caller decides whether that is an error.
 */
export function findTokenSpec(reference: string): TokenSpec | undefined {
    const wanted = reference.trim().toLowerCase();
    if (wanted === "") return undefined;
    const catalogue = listTokenCatalogue();
    return (
        catalogue.find((e) => e.key.toLowerCase() === wanted)?.spec ??
        catalogue.find((e) => e.name.toLowerCase() === wanted)?.spec
    );
}
