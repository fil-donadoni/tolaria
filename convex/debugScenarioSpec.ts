import { v } from "convex/values";

// Debug scenario spec (issue #769, ADR 0044). The *argument* to the existing,
// unchanged `debugSetupScenario` builder (`convex/game.ts`) — the card
// placements plus global setup — relocated out of the `PRESET_SCENARIOS` code
// literal into the `debugScenarios` Convex table. The shape mirrors
// `debugSetupScenario`'s `args` minus `gameId`; keep the two in lock-step.
//
// The table column itself is stored as `v.any()` so the LOAD path is TOLERANT
// (ADR 0044 "tolerant builder"): a row written under today's shape must still
// load after a future field is added or removed — unknown fields are ignored
// and missing ones defaulted at load, never rejected. This validator is used
// only on the WRITE path (`saveDebugScenario`), where we control the shape and
// want well-formed rows.

/** A single card placement — mirrors the `cards[]` entry of
 *  `debugSetupScenario` (`convex/game.ts`). */
export const scenarioCardValidator = v.object({
    name: v.string(),
    owner: v.union(v.literal("me"), v.literal("opp")),
    zone: v.optional(
        v.union(
            v.literal("hand"),
            v.literal("battlefield"),
            v.literal("library"),
            v.literal("graveyard"),
            v.literal("exile")
        )
    ),
    tapped: v.optional(v.boolean()),
    count: v.optional(v.number()),
    position: v.optional(v.number()),
    attachedTo: v.optional(v.string()),
    damageMarked: v.optional(v.number()),
    faceDown: v.optional(v.boolean()),
    faceDownExile: v.optional(v.boolean()),
    castableFromExile: v.optional(v.boolean()),
    counters: v.optional(v.record(v.string(), v.number())),
    attackedLastTurn: v.optional(v.boolean()),
    summoningSick: v.optional(v.boolean()),
    copyOf: v.optional(v.string()),
});

/** The full spec accepted by the save path — the `debugSetupScenario` args
 *  minus `gameId`. Only `cards` is required; everything else defaults in the
 *  builder. */
export const scenarioSpecValidator = v.object({
    cards: v.array(scenarioCardValidator),
    phase: v.optional(v.string()),
    landCount: v.optional(v.number()),
    libraryCount: v.optional(v.number()),
    turn: v.optional(v.number()),
    markLastDrawn: v.optional(v.boolean()),
    rngSeed: v.optional(v.number()),
    poison: v.optional(
        v.object({
            me: v.optional(v.number()),
            opp: v.optional(v.number()),
        })
    ),
});

export type ScenarioCard = {
    name: string;
    owner: "me" | "opp";
    zone?: "hand" | "battlefield" | "library" | "graveyard" | "exile";
    tapped?: boolean;
    count?: number;
    position?: number;
    attachedTo?: string;
    damageMarked?: number;
    faceDown?: boolean;
    faceDownExile?: boolean;
    castableFromExile?: boolean;
    counters?: Record<string, number>;
    attackedLastTurn?: boolean;
    summoningSick?: boolean;
    copyOf?: string;
};

export type ScenarioSpec = {
    cards: ScenarioCard[];
    phase?: string;
    landCount?: number;
    libraryCount?: number;
    turn?: number;
    markLastDrawn?: boolean;
    rngSeed?: number;
    poison?: { me?: number; opp?: number };
};

// ---- Disposable / promotable policy (issue #772, ADR 0044) -----------------

/**
 * Schema-drift tag stamped onto GOLDEN rows only (ADR 0044: "only the few golden
 * rows warrant a version tag"). Bump this whenever the persisted spec shape
 * changes in a way a long-lived curated row should be re-checked against — a
 * golden row carrying an older version signals it predates the change. Ephemeral
 * rows are disposable, so they never carry (or need) the tag.
 */
export const SCENARIO_SCHEMA_VERSION = 1;

/**
 * Default number of ephemeral (non-golden) rows to KEEP per user during a
 * cleanup pass; older ephemeral rows beyond this bound are pruned. Golden rows
 * never count against the bound and are never pruned. Relocating the "too many
 * scenarios" problem into the DB on purpose — where it is bounded and prunable —
 * is the whole point (ADR 0044).
 */
export const EPHEMERAL_KEEP_BOUND = 25;

/** The row fields the pruning policy reads — a structural subset so the decision
 *  is pure and testable without a Convex `Doc`. */
export type PrunableScenarioRow<Id> = {
    _id: Id;
    golden?: boolean;
    createdAt: number;
};

/**
 * Pure cleanup policy (ADR 0044). Given a user's scenario rows, return the ids of
 * the EPHEMERAL rows to prune: golden rows are always kept (never returned);
 * ephemeral rows are kept newest-first up to `keep`, and every ephemeral row
 * beyond that bound is returned for deletion. Deterministic and side-effect-free
 * so the mutation is a thin wrapper the tests can drive directly.
 */
export function selectEphemeralIdsToPrune<Id>(
    rows: readonly PrunableScenarioRow<Id>[],
    keep: number = EPHEMERAL_KEEP_BOUND
): Id[] {
    const ephemeral = rows
        .filter((row) => row.golden !== true)
        .sort((a, b) => b.createdAt - a.createdAt);
    return ephemeral.slice(Math.max(0, keep)).map((row) => row._id);
}

// ---- Tolerant load helpers -------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function pickNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function pickBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

/** Assign only when defined, so the resulting object carries ONLY known,
 *  present fields — undefined optionals are simply omitted (the builder
 *  applies its own defaults). */
function set<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: T[K] | undefined
): void {
    if (value !== undefined) target[key] = value;
}

const ZONES = ["hand", "battlefield", "library", "graveyard", "exile"] as const;

function normalizeCard(raw: unknown): ScenarioCard | null {
    if (!isRecord(raw)) return null;
    const name = pickString(raw.name);
    if (name === undefined) return null;
    // `owner` defaults to "me" when absent/invalid — a tolerant load must not
    // throw on a malformed row (ADR 0044).
    const owner: "me" | "opp" = raw.owner === "opp" ? "opp" : "me";
    const card: ScenarioCard = { name, owner };

    const zone = pickString(raw.zone);
    if (zone !== undefined && (ZONES as readonly string[]).includes(zone)) {
        card.zone = zone as ScenarioCard["zone"];
    }
    set(card, "tapped", pickBoolean(raw.tapped));
    set(card, "count", pickNumber(raw.count));
    set(card, "position", pickNumber(raw.position));
    set(card, "attachedTo", pickString(raw.attachedTo));
    set(card, "damageMarked", pickNumber(raw.damageMarked));
    set(card, "faceDown", pickBoolean(raw.faceDown));
    set(card, "faceDownExile", pickBoolean(raw.faceDownExile));
    set(card, "castableFromExile", pickBoolean(raw.castableFromExile));
    set(card, "attackedLastTurn", pickBoolean(raw.attackedLastTurn));
    set(card, "summoningSick", pickBoolean(raw.summoningSick));
    set(card, "copyOf", pickString(raw.copyOf));

    if (isRecord(raw.counters)) {
        const counters: Record<string, number> = {};
        for (const [key, value] of Object.entries(raw.counters)) {
            const n = pickNumber(value);
            if (n !== undefined) counters[key] = n;
        }
        card.counters = counters;
    }
    return card;
}

/**
 * Tolerant load (ADR 0044). Turn a raw, un-typechecked DB row spec into the
 * clean `debugSetupScenario` argument object: unknown fields are DROPPED and
 * missing ones are left out so the builder applies its own defaults. Never
 * throws — a wholly malformed spec degrades to an empty board (`{ cards: [] }`).
 * Card-name resolution is NOT done here; it is validated at save time (and by
 * the builder's `getCardByName`) so an unresolved name surfaces an error rather
 * than corrupting state.
 */
export function normalizeScenarioSpec(raw: unknown): ScenarioSpec {
    if (!isRecord(raw)) return { cards: [] };
    const cards = Array.isArray(raw.cards)
        ? raw.cards
              .map(normalizeCard)
              .filter((c): c is ScenarioCard => c !== null)
        : [];
    const spec: ScenarioSpec = { cards };
    set(spec, "phase", pickString(raw.phase));
    set(spec, "landCount", pickNumber(raw.landCount));
    set(spec, "libraryCount", pickNumber(raw.libraryCount));
    set(spec, "turn", pickNumber(raw.turn));
    set(spec, "markLastDrawn", pickBoolean(raw.markLastDrawn));
    set(spec, "rngSeed", pickNumber(raw.rngSeed));
    if (isRecord(raw.poison)) {
        const poison: { me?: number; opp?: number } = {};
        set(poison, "me", pickNumber(raw.poison.me));
        set(poison, "opp", pickNumber(raw.poison.opp));
        spec.poison = poison;
    }
    return spec;
}

/**
 * Collect the names in a spec that DON'T resolve to a real card in the
 * catalogue, using an injected lookup (`tryGetCardByName`) so this module stays
 * free of a direct registry import and safe to pull into the frontend bundle.
 * The save path rejects a spec with any unresolved name (ADR 0044: "an
 * unresolved card is rejected before write"). Also scans `attachedTo` / `copyOf`
 * host references, which the builder likewise resolves by name.
 */
export function collectUnresolvedCardNames(
    spec: ScenarioSpec,
    resolves: (name: string) => boolean
): string[] {
    const unresolved = new Set<string>();
    for (const card of spec.cards) {
        if (!resolves(card.name)) unresolved.add(card.name);
        if (card.attachedTo && !resolves(card.attachedTo)) {
            unresolved.add(card.attachedTo);
        }
        if (card.copyOf && !resolves(card.copyOf)) {
            unresolved.add(card.copyOf);
        }
    }
    return [...unresolved];
}
