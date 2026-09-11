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
    // CR 111 / 707.2 — this entry places a TOKEN, not a card: `name` is then a
    // token-catalogue key (`convex/cards/tokenCatalogue.ts`), not a card name,
    // and the builder creates it through `createTokenPermanents`. Battlefield
    // only (CR 111.7: a token in any other zone ceases to exist).
    token: v.optional(v.boolean()),
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
    // CR 305.9 (issue #1689) — only when this is ALSO set does
    // `castableFromExile` grant the LAND-INCLUSIVE shape (Headliner
    // Scarlett / Expressive Iteration); omitted/false stages the cast-only
    // shape (Ice Cauldron / Robber of the Rich / Ragavan). See
    // `scenarioBuilder.ts` for the full rationale.
    castableFromExileIncludesLand: v.optional(v.boolean()),
    counters: v.optional(v.record(v.string(), v.number())),
    // CR 602.5 (issue #3448) — per-turn activation tallies ALREADY SPENT,
    // keyed by ability id exactly as the engine's
    // `CardInstanceState.activationsThisTurn` is, so `{ "<abilityId>": 1 }`
    // makes an `oncePerTurn` ability read as already used and the rebuilt
    // position offers no activation of it. NOT battlefield-only: the engine
    // deliberately preserves the tally when a card LEAVES the battlefield and
    // clears it on the way back IN (`resetBattlefieldTransientState`,
    // CR 400.7 — the object that re-enters is a new one), so a graveyard /
    // exile card can legitimately carry one and a zone-limited field would
    // lower it lossily.
    activations: v.optional(v.record(v.string(), v.number())),
    attackedLastTurn: v.optional(v.boolean()),
    summoningSick: v.optional(v.boolean()),
    copyOf: v.optional(v.string()),
});

/** The phases a debug scenario may OPEN in — the `Phase` union
 *  (`convex/gre/types.ts`) minus the transient steps a saved board never wants
 *  to start on (`MULLIGAN` / `UNTAP` / `CLEANUP`, plus `FIRST_STRIKE_DAMAGE`,
 *  which only exists while first-strike damage is being dealt).
 *
 *  ONE vocabulary for every surface that offers a phase: the LLM generator's
 *  JSON-schema enum (`convex/debugScenarioGenerator.core.ts`) and the admin
 *  form's phase select (`src/components/debug/debug-scenario-spec-fields.tsx`).
 *  They disagreed until issue #3463 — the form offered `BEGINNING` / `COMBAT` /
 *  `ENDING`, which are not `Phase` members at all, so picking one wrote a phase
 *  the builder casts straight onto `state.phase` and no step ever matches,
 *  while a generated `DECLARE_ATTACKERS` had no option to render against and
 *  was silently dropped on the next edit. */
export const SCENARIO_PHASES = [
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
    "POSTCOMBAT_MAIN",
    "END_STEP",
] as const;

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
    // CR 119.1 (issue #2147) — seed starting life totals, so a saved scenario
    // can pin a life-dependent decision (chump-block vs. race, burn the
    // creature vs. the face, a lethal check) instead of opening at the
    // default. Mirrors `poison`'s per-seat, both-optional shape exactly.
    life: v.optional(
        v.object({
            me: v.optional(v.number()),
            opp: v.optional(v.number()),
        })
    ),
    // CR 122.1 (issue #1969) — seed experience counters, so a saved scenario
    // can start at the SCALING state a "for each experience counter you have"
    // card reads. Mirrors `debugSetupScenario`'s matching arg
    // (`convex/game.ts`).
    experience: v.optional(
        v.object({
            me: v.optional(v.number()),
            opp: v.optional(v.number()),
        })
    ),
    // CR 305.2 (issue #3446) — land drops already spent this turn. Without it
    // every rebuild opens with the drop unused, so a MAIN-PHASE decision taken
    // after the land was played rebuilds as a position that still offers
    // "play <land>" — a different decision under the same name, which is the
    // failure the verdict quiz refuses on (PRD #3397). Mirrors `poison` /
    // `life` / `experience`'s per-seat, both-optional shape exactly.
    landsPlayed: v.optional(
        v.object({
            me: v.optional(v.number()),
            opp: v.optional(v.number()),
        })
    ),
    // CR 102.1 / 117.1 (issue #3454) — the TURN HOLDER and the PRIORITY
    // holder, the two facts that decide WHICH decision a rebuilt position
    // poses. Without them every position captured with priority on the
    // opponent's turn rebuilds as the judged seat's own turn, offering the
    // sorcery-speed moves it did not have (CR 307.1) — a different question
    // under the same name, which is why the verdict quiz used to REFUSE that
    // whole class outright (`src/lib/ai/verdict-quiz.ts`, PRD #3397).
    //
    // Both default to today's behaviour: no `activePlayer` leaves the base
    // state's turn holder untouched, and no `priority` gives priority to
    // whoever ends up active.
    activePlayer: v.optional(v.union(v.literal("me"), v.literal("opp"))),
    priority: v.optional(v.union(v.literal("me"), v.literal("opp"))),
    // CR 117.4 — consecutive passes are what END something (a resolution, a
    // step). A position captured with one pass already banked rebuilds as a
    // fresh priority round without this, which is a different decision
    // whenever passing is the move under judgement. Default 0.
    //
    // Deliberately unvalidated beyond "a number": COHERENCE is the caller's
    // job, as it already is for `phase` (a spec may name DECLARE_BLOCKERS with
    // no attackers). `specFromState` only ever lowers a count a live game
    // reached, and the builder has no way to know what a hand-written 2 was
    // meant to mean — rejecting it would be guessing, so it is placed as
    // written and the position it makes is the author's.
    passCount: v.optional(v.number()),
    // CR 702.139c / ADR 0064 (issue #1392) — directly declare a companion
    // into a slot, bypassing the sideboard/maindeck auto-declare a
    // scenario's synthetic board never runs through. Mirrors
    // `debugSetupScenario`'s matching arg (`convex/game.ts`).
    companion: v.optional(
        v.object({
            name: v.string(),
            owner: v.optional(v.union(v.literal("me"), v.literal("opp"))),
            used: v.optional(v.boolean()),
        })
    ),
});

export type ScenarioCard = {
    name: string;
    owner: "me" | "opp";
    /** CR 111 / 707.2 — place a TOKEN whose shape `name` names in the token
     *  catalogue (`convex/cards/tokenCatalogue.ts`), rather than a card.
     *  Battlefield only. */
    token?: boolean;
    zone?: "hand" | "battlefield" | "library" | "graveyard" | "exile";
    tapped?: boolean;
    count?: number;
    position?: number;
    attachedTo?: string;
    damageMarked?: number;
    faceDown?: boolean;
    faceDownExile?: boolean;
    castableFromExile?: boolean;
    castableFromExileIncludesLand?: boolean;
    counters?: Record<string, number>;
    /** CR 602.5 (issue #3448) — per-turn activation tallies already spent,
     *  keyed by ability id. Any zone; see the validator's own note. */
    activations?: Record<string, number>;
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
    /** CR 119.1 (issue #2147) — seed starting life totals, so a scenario can
     *  pin a life-dependent decision (chump-block vs. race, a lethal check)
     *  instead of opening at the default 20. */
    life?: { me?: number; opp?: number };
    /** CR 122.1 (issue #1969) — seed experience counters on a player, so a
     *  scenario can start at the SCALING state a card's "for each experience
     *  counter you have" reads (Otharri, Suns' Glory). */
    experience?: { me?: number; opp?: number };
    /** CR 305.2 / 305.2a (issue #3446) — lands this seat has already played
     *  this turn. Omitted means none: the builder CLEARS the tally like the
     *  other per-turn ones (the `drawnThisTurn` precedent, issue #3240), so a
     *  spec written before this field keeps rebuilding a board with the land
     *  drop available. */
    landsPlayed?: { me?: number; opp?: number };
    /** CR 102.1 (issue #3454) — whose turn the position is. Omitted leaves the
     *  base state's turn holder untouched, which is what every spec written
     *  before this field meant. */
    activePlayer?: "me" | "opp";
    /** CR 117.1 (issue #3454) — who holds priority. Omitted gives it to the
     *  active player, the pre-#3454 behaviour. `activePlayer: "opp"` with
     *  `priority: "me"` is the shape an instant-speed decision on the
     *  opponent's turn needs (holding up removal, a combat trick). */
    priority?: "me" | "opp";
    /** CR 117.4 (issue #3454) — passes already banked in this priority round.
     *  Omitted means 0, the pre-#3454 behaviour. */
    passCount?: number;
    companion?: { name: string; owner?: "me" | "opp"; used?: boolean };
};

/** The validator's own field names — the WRITE-path shape, which is what a
 *  saved row is checked against. */
type ValidatorSpecKey = keyof typeof scenarioSpecValidator.fields;

/**
 * Compile-time mirror between `scenarioSpecValidator` and `ScenarioSpec`: the
 * `satisfies` reds `tsc` when the TYPE gains a spec-level field the validator
 * does not declare, which is exactly the drift that would make the two
 * exhaustiveness guards below vacuous (they would sweep a key list that is
 * missing the new field and report full coverage).
 */
const SCENARIO_SPEC_KEY_PRESENCE = Object.fromEntries(
    Object.keys(scenarioSpecValidator.fields).map((key) => [key, true])
) as Record<ValidatorSpecKey, true> satisfies Record<keyof ScenarioSpec, true>;

/**
 * Every SPEC-LEVEL key, derived from the write-path validator rather than
 * hand-listed (issue #3463). Two surfaces must stay exhaustive over it — the
 * admin form (`src/components/debug/scenario-spec-ownership.ts`) and the LLM
 * generator's JSON schema (`convex/debugScenarioGenerator.core.ts`) — and both
 * guards key on THIS list, so a field added to the validator without a home in
 * either surface reds a test instead of silently becoming untypeable in the
 * form and ungeneratable by the model.
 */
export const SCENARIO_SPEC_KEYS = Object.keys(
    SCENARIO_SPEC_KEY_PRESENCE
) as (keyof ScenarioSpec)[];

// ---- Battlefield counter resolution ----------------------------------------

/** The engine's canonical loyalty-counter key (CR 306.5b). Loyalty lives in the
 *  same generic `counters` map as +1/+1 etc., under this exact lowercase key —
 *  the loyalty badge (`loyalty-badge.tsx`), damage removal
 *  (`removeLoyaltyForDamage`) and the zero-loyalty SBA (`checkZeroLoyaltySBA`)
 *  all read `counters["loyalty"]`. */
export const LOYALTY_COUNTER = "loyalty";

/**
 * Resolve the counters a scenario places on a BATTLEFIELD card into the engine's
 * canonical shape. Two corrections over the raw spec record:
 *
 *  1. **Loyalty key canonicalization.** The editor's counter *type* is free
 *     text, so any case variant of the loyalty key ("Loyalty", "LOYALTY") is
 *     folded onto the lowercase `loyalty` the engine reads — otherwise the
 *     value renders as an inert cosmetic counter instead of real loyalty.
 *  2. **Planeswalker starting loyalty (CR 306.5b).** A planeswalker placed by
 *     the scenario builder bypasses the normal ETB path (`gre/state.ts`), which
 *     is where a walker is seeded with loyalty counters equal to its printed
 *     starting loyalty. So when the spec sets no explicit loyalty counter, seed
 *     the printed `loyalty` — otherwise the walker enters at 0 and the
 *     zero-loyalty SBA sweeps it immediately.
 *
 * Returns `undefined` when there are no counters to place, so the caller leaves
 * the instance's `counters` field unset (the builder's minimal shape).
 */
export function resolveScenarioBattlefieldCounters(
    rawCounters: Record<string, number> | undefined,
    pw: { isPlaneswalker: boolean; printedLoyalty?: number }
): Record<string, number> | undefined {
    const counters: Record<string, number> = {};
    for (const [type, n] of Object.entries(rawCounters ?? {})) {
        const key =
            type.toLowerCase() === LOYALTY_COUNTER ? LOYALTY_COUNTER : type;
        counters[key] = n;
    }
    if (
        pw.isPlaneswalker &&
        (counters[LOYALTY_COUNTER] ?? 0) <= 0 &&
        pw.printedLoyalty !== undefined &&
        pw.printedLoyalty > 0
    ) {
        counters[LOYALTY_COUNTER] = pw.printedLoyalty;
    }
    return Object.keys(counters).length > 0 ? counters : undefined;
}

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

// ---- DB-direct write path (issue #1453) ------------------------------------
//
// `seedScenarioDirect` (`convex/debugScenarios.ts`) is the DB-direct write
// path for agents (design doc 2026-07-21-db-direct-debug-scenarios-design.md):
// an agent writes ONE scenario straight to the DB. The insert-vs-patch
// decision below is the pure seam — mirrors `selectEphemeralIdsToPrune`'s
// structural-subset-row style — so it's unit-testable without a
// `convex-test` harness (this repo has none, see `debugScenarios.test.ts`).

/** The row fields the upsert decision reads — a structural subset so the
 *  decision is pure and testable without a Convex `Doc`. */
export type UpsertableScenarioRow<Id> = {
    _id: Id;
    label: string;
};

/** The insert-vs-patch decision `seedScenarioDirect` acts on. */
export type ScenarioUpsertDecision<Id> =
    | { action: "insert" }
    | { action: "patch"; id: Id };

/**
 * Pure upsert-by-label decision (issue #1453). Given the existing
 * `debugScenarios` rows and the label a direct write targets, decide whether
 * `seedScenarioDirect` should PATCH the existing same-label row (return its
 * id) or INSERT a new one — at most one row per label, so re-running a direct
 * write for the same scenario updates it in place instead of accumulating
 * duplicates. Deterministic and side-effect-free so the mutation is a thin
 * wrapper the tests can drive directly.
 */
export function selectScenarioUpsert<Id>(
    rows: readonly UpsertableScenarioRow<Id>[],
    label: string
): ScenarioUpsertDecision<Id> {
    const existing = rows.find((row) => row.label === label);
    return existing
        ? { action: "patch", id: existing._id }
        : { action: "insert" };
}

/**
 * `seedScenarioDirect`'s `golden` default (issue #1453): an agent-authored
 * scenario written direct-to-DB is a curated row by default — `golden`
 * defaults to `true` when the caller omits it, so it isn't pruned by
 * `cleanupEphemeralScenarios` before anyone loads it. Extracted as its own
 * one-line pure function so the default is asserted directly, the same way
 * the other decisions on this page are — no `convex-test` harness needed.
 */
export function resolveScenarioGolden(golden: boolean | undefined): boolean {
    return golden ?? true;
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
    set(card, "token", pickBoolean(raw.token));
    set(card, "tapped", pickBoolean(raw.tapped));
    set(card, "count", pickNumber(raw.count));
    set(card, "position", pickNumber(raw.position));
    set(card, "attachedTo", pickString(raw.attachedTo));
    set(card, "damageMarked", pickNumber(raw.damageMarked));
    set(card, "faceDown", pickBoolean(raw.faceDown));
    set(card, "faceDownExile", pickBoolean(raw.faceDownExile));
    set(card, "castableFromExile", pickBoolean(raw.castableFromExile));
    set(
        card,
        "castableFromExileIncludesLand",
        pickBoolean(raw.castableFromExileIncludesLand)
    );
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
    // CR 602.5 (issue #3448) — same tolerant shape as `counters` right above:
    // a `Record<string, number>` keyed by ability id, non-numeric values
    // dropped rather than thrown on (ADR 0044).
    if (isRecord(raw.activations)) {
        const activations: Record<string, number> = {};
        for (const [key, value] of Object.entries(raw.activations)) {
            const n = pickNumber(value);
            if (n !== undefined) activations[key] = n;
        }
        card.activations = activations;
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
    if (isRecord(raw.life)) {
        const life: { me?: number; opp?: number } = {};
        set(life, "me", pickNumber(raw.life.me));
        set(life, "opp", pickNumber(raw.life.opp));
        spec.life = life;
    }
    if (isRecord(raw.experience)) {
        const experience: { me?: number; opp?: number } = {};
        set(experience, "me", pickNumber(raw.experience.me));
        set(experience, "opp", pickNumber(raw.experience.opp));
        spec.experience = experience;
    }
    if (isRecord(raw.landsPlayed)) {
        const landsPlayed: { me?: number; opp?: number } = {};
        set(landsPlayed, "me", pickNumber(raw.landsPlayed.me));
        set(landsPlayed, "opp", pickNumber(raw.landsPlayed.opp));
        spec.landsPlayed = landsPlayed;
    }
    const activePlayer = pickString(raw.activePlayer);
    if (activePlayer === "me" || activePlayer === "opp") {
        spec.activePlayer = activePlayer;
    }
    const priority = pickString(raw.priority);
    if (priority === "me" || priority === "opp") spec.priority = priority;
    set(spec, "passCount", pickNumber(raw.passCount));
    if (isRecord(raw.companion)) {
        const name = pickString(raw.companion.name);
        if (name !== undefined) {
            const companion: {
                name: string;
                owner?: "me" | "opp";
                used?: boolean;
            } = { name };
            const owner = pickString(raw.companion.owner);
            if (owner === "me" || owner === "opp") companion.owner = owner;
            set(companion, "used", pickBoolean(raw.companion.used));
            spec.companion = companion;
        }
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
    resolves: (name: string) => boolean,
    /** Resolver for TOKEN references (`card.token === true`, and an
     *  `attachedTo` host that names a token rather than a card) — injected the
     *  same way as `resolves` so this module stays registry-free. Defaults to
     *  "no token resolves", which fails LOUD at a call site that hasn't been
     *  taught about tokens rather than waving an unloadable row through. */
    resolvesToken: (name: string) => boolean = () => false
): string[] {
    const unresolved = new Set<string>();
    for (const card of spec.cards) {
        if (card.token) {
            if (!resolvesToken(card.name)) unresolved.add(card.name);
        } else if (!resolves(card.name)) {
            unresolved.add(card.name);
        }
        // CR 303.4 / 701.3 — an Aura/Equipment host may itself be a token
        // (enchant a Saproling), so either resolution vouches for the name.
        if (
            card.attachedTo &&
            !resolves(card.attachedTo) &&
            !resolvesToken(card.attachedTo)
        ) {
            unresolved.add(card.attachedTo);
        }
        // `copyOf` stays CARD-only: a copy presents a printed card's
        // characteristics (CR 707.2), and the builder resolves it through
        // `getCardByName`.
        if (card.copyOf && !resolves(card.copyOf)) {
            unresolved.add(card.copyOf);
        }
    }
    if (spec.companion && !resolves(spec.companion.name)) {
        unresolved.add(spec.companion.name);
    }
    return [...unresolved];
}
