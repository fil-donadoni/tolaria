// Canned-scenario auto-test generator for DSL cards (ADR 0045 testing regime,
// issue #804). For every DSL-only Effect Script in the catalogue this derives a
// SMOKE TEST with zero per-card authoring: it builds a canned GameState that
// satisfies the script's requirements (targets, zones, library depth, count
// sets), executes the script through the REAL resolution path
// (`resolveTopOfStack` — the same seam an imperative card flows through, ADR
// 0045 "one execution path"), and asserts the outcomes the script ITSELF
// declares (damage dealt, cards drawn, life changed, permanents destroyed /
// exiled…).
//
// This is the per-card execution safety net that catches transcription
// mistakes a schema-valid script can still contain: wrong recipient, wrong
// zone, wrong player. Static validation (`validate.ts`) proves the script is
// well-formed; this proves it does what its Ops say.
//
// Design (ADR 0045 §"Testing shifts from per-card to per-Op"):
//   - Requirement analysis walks the Ops and returns a SCENARIO SPEC (how many
//     player / permanent targets, how deep a library, which count sets to
//     populate) OR an explicit SKIP with a reason — a script the generator
//     cannot faithfully set up is REPORTED, never silently passed.
//   - Assertion derivation is keyed PER OP KIND (`OP_ASSERTORS`). Every
//     registered Op must have an assertor or the coverage guard test fails, so
//     a newly-added Op kind cannot ship without smoke coverage.
//   - The scenario is deterministic and self-contained: two fixed players, a
//     bank of vanilla bears for targets / library / zones, no RNG.
//
// The generator itself is unit-tested in
// `convex/gre/effects/__tests__/scenarioGenerator.test.ts`; the catalogue sweep
// that RUNS it over every DSL card lives in
// `convex/cards/__tests__/effectScriptSmoke.test.ts`.

import type {
    ActivatedAbility,
    CardDefinition,
    EffectCountSpec,
    EffectObjectSelector,
    EffectOp,
    EffectPlayerRef,
    EffectValue,
    TargetSelection,
    TriggeredAbility,
} from "../../cards/types";
import type { CompiledTriggerHead } from "../../cards/compiledTriggers";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import { EFFECT_OP_REGISTRY } from "../../cards/mechanicsRegistry";
import { classLevelOf } from "../../cards/abilities/classLevels";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { readPlayerCounters } from "../playerCounters";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

/** The two fixed seats every generated scenario uses: p1 casts, p2 is the
 *  opponent / target owner. CR 102.2 — a two-player game. */
export const CASTER_ID = "p1";
export const OPPONENT_ID = "p2";

/** The instance id of the SOURCE permanent a scenario seeds when an ability
 *  script acts on `{ ref: "$source" }` (issue #3831). It carries the HOST
 *  card's own kind (issue #3879) and sits on the caster's battlefield; the
 *  caller pushes the ability's stack item under this same id, which is what
 *  binds `$source` to it (CR 113.7 — an ability's source is the object that
 *  created it; `seedSourceBindings` in `interpreter.ts` snapshots
 *  `sourceInstanceId`, i.e. the stack item's id). */
export const SOURCE_PERMANENT_ID = "gen-source";

/** Where a script is hosted. Only an ABILITY has a source permanent for
 *  `$source` to name (CR 113.7); a spell's `$source` is the spell itself on
 *  the stack, which the canned scenario does not model — so a spell-site
 *  `$source` subject stays a card-dependent skip. */
export type SmokeSite = "spell" | "ability";

/**
 * What the planner must know about an ability's SOURCE to seed it faithfully
 * (issue #3879). Both halves were previously assumed rather than read, and each
 * assumption was a fail-open:
 *
 * - **Kind.** The source used to be the generic filler creature whatever the
 *   real card was, so an Op whose primitive refuses a non-creature subject
 *   (`setExileOnDeath` / `setDamageLockThisTurn` /
 *   `setTargetCantBeRegeneratedThisTurn` all return early on one) was proven
 *   against a creature it would never see. The host definition's own card
 *   types / subtypes / P/T (CR 205, CR 208.1) come in here instead.
 * - **Zone at resolution.** The source used to be assumed on the battlefield.
 *   A trigger head that fires on the source's OWN death or departure
 *   (CR 603.10) resolves with the source already gone, and an effect reading
 *   it then uses last known information (CR 608.2h): `$source` binds to
 *   nothing and the Op does nothing. Same for an ability activated from a
 *   graveyard or a hand (CR 113.6). `false` here makes `$source` unmodelled,
 *   exactly as at a spell site — a card-dependent skip.
 */
export interface SmokeSourceSpec {
    /** The host definition's card types — the type line the card is printed
     *  with (CR 205.1). */
    readonly types: readonly CardInstanceState["types"][number][];
    readonly subtypes?: readonly string[];
    readonly power?: number;
    readonly toughness?: number;
    readonly onBattlefieldAtResolution: boolean;
}

/** Where a script is hosted, and — at an ability site — what its source is and
 *  where. Passed as ONE descriptor rather than a widening list of positional
 *  flags, so a new fact about the host arrives without another argument. */
export type SmokeHost =
    | { readonly site: "spell" }
    | { readonly site: "ability"; readonly source: SmokeSourceSpec };

/** The host of a spell-site script — the fail-closed default: no source
 *  permanent, so a `$source` subject is a card-dependent skip. */
export const SPELL_HOST: SmokeHost = Object.freeze({ site: "spell" as const });

/** CR 113.6b — an ability that states which zones it functions in functions
 *  only from those zones, and these two flags are how a definition states it:
 *  an ability activated from a GRAVEYARD or a HAND does not resolve with its
 *  source on the battlefield.
 *  Read off the two declarative flags the engine itself dispatches on, so the
 *  planner and `activateAbility` cannot disagree. */
export function activatedAbilitySourceOnBattlefield(
    ability: Pick<
        ActivatedAbility,
        "activateFromGraveyard" | "activateFromHand"
    >
): boolean {
    return (
        ability.activateFromGraveyard !== true &&
        ability.activateFromHand !== true
    );
}

/** CR 603.10 / 608.2h — a HAND-AUTHORED triggered ability whose source
 *  functions from somewhere other than the battlefield. The three declarative
 *  zone flags on `TriggeredAbility` are the only structured statement such an
 *  ability makes about where its source is; a self-death head carries no flag
 *  and is not decidable here (the COMPILED twin below is, and it is the one
 *  the Oracle gate goes through). */
export function triggeredAbilitySourceOnBattlefield(
    ability: Pick<
        TriggeredAbility,
        "zone" | "functionsFromStack" | "functionsFromOwnDiscard"
    >
): boolean {
    return (
        ability.zone === undefined &&
        ability.functionsFromStack !== true &&
        ability.functionsFromOwnDiscard !== true
    );
}

/**
 * Whether the source of a COMPILED triggered ability is still on the
 * battlefield when that ability resolves — the mechanism that replaces the
 * prose note the Oracle gate used to carry (issue #3879).
 *
 * Exhaustive over `CompiledTriggerHead["kind"]` as a `Record`, so a head the
 * grammar learns tomorrow is a TYPE ERROR here rather than a silent
 * "battlefield". Only a head keyed on the source's OWN departure answers
 * `false`: CR 603.10 makes it a leaves-the-battlefield trigger that looks back
 * in time, so the ability resolves with its source gone and `$source` reads
 * last known information (CR 608.2h).
 *
 * `died` with a scope that merely INCLUDES the source among many ("whenever a
 * creature dies", scope `any`) stays `true`: the case the card is about is
 * another creature dying with the source still there, which is exactly what
 * the canned scenario seeds.
 */
const COMPILED_TRIGGER_SOURCE_SURVIVES: Record<
    CompiledTriggerHead["kind"],
    (head: CompiledTriggerHead) => boolean
> = {
    entered: () => true,
    // `self` is the source itself dying. `host` is an Aura's "whenever
    // enchanted creature dies": the creature dies, the now-unattached Aura is
    // put into its owner's graveyard by the attachment SBA (CR 704.5m), and
    // the trigger resolves with its own source gone too.
    died: (head) =>
        !("scope" in head && (head.scope === "self" || head.scope === "host")),
    attacks: () => true,
    // CR 508.3a / 509.3a — the source watches OTHER creatures declare; nothing
    // in either event moves it.
    "attacks-or-blocks": () => true,
    "combat-damage-to-player": () => true,
    // CR 120.3 — the source is the DAMAGE dealer or recipient, and it is still
    // on the battlefield when the trigger is put on the stack.
    "damage-dealt": () => true,
    "damage-taken": () => true,
    phase: () => true,
    "spell-cast": () => true,
};

export function compiledTriggerSourceOnBattlefield(
    head: CompiledTriggerHead
): boolean {
    return COMPILED_TRIGGER_SOURCE_SURVIVES[head.kind](head);
}

/** The ability-site host for a script hosted by `definition`, given where that
 *  ability's source is at resolution. The ONE constructor both the Oracle gate
 *  and the catalogue sweep go through, so neither can seed a source the other
 *  would not. */
export function abilityHost(
    definition: {
        types: readonly CardInstanceState["types"][number][];
        subtypes?: readonly string[];
        power?: number;
        toughness?: number;
    },
    onBattlefieldAtResolution: boolean
): SmokeHost {
    return {
        site: "ability",
        source: {
            types: definition.types,
            ...(definition.subtypes === undefined
                ? {}
                : { subtypes: definition.subtypes }),
            ...(definition.power === undefined
                ? {}
                : { power: definition.power }),
            ...(definition.toughness === undefined
                ? {}
                : { toughness: definition.toughness }),
            onBattlefieldAtResolution,
        },
    };
}

/** A vanilla creature used as a filler target / library card / zone occupant.
 *  Toughness is high (8) so a smoke-test damage Op leaves observable marked
 *  damage (CR 120.3) instead of killing the creature and moving it out from
 *  under a follow-up assertion — sized above the largest single-target
 *  `dealDamage` amount in the catalogue (Mine Collapse's 5, issue #690).
 *  Registered lazily by callers — the generator itself only references the
 *  id. */
export const FILLER_CARD_ID = "gen-scenario-filler";

/** The stable subtype the filler card carries, so a `count` set filtered by
 *  subtype can be satisfied by spawning filler cards. */
export const FILLER_SUBTYPE = "Bear";

/** The ONE canonical filler `CardDefinition` — every caller that needs
 *  `FILLER_CARD_ID` registered (the catalogue sweep and the generator's own
 *  unit tests) MUST register this exact object, not a hand-copied literal.
 *  `registerTokenDefinition` keys a single shared, non-isolated registry
 *  (`convex/cards/index.ts`) by id; under the node Vitest project's
 *  `isolate: false` (perf lever, see `vitest.config.ts`), test files sharing
 *  a worker share that registry too. Two divergent literals for the same id
 *  raced on module-load order — whichever file's top-level
 *  `registerTokenDefinition` ran last in the worker won, silently swapping
 *  the filler's toughness out from under whichever test happened to run
 *  after it. That's exactly how issue #690's toughness-8 fix regressed: a
 *  second, stale toughness-5 copy in `scenarioGenerator.test.ts` kept
 *  overwriting it depending on file ordering (issue #926 test-isolation
 *  fallout). A single exported constant makes the two call sites incapable
 *  of disagreeing. */
export const FILLER_CARD_DEFINITION: CardDefinition = {
    id: FILLER_CARD_ID,
    name: FILLER_CARD_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: [FILLER_SUBTYPE],
    power: 2,
    toughness: 8,
};

/** How many cards to seed for an open-ended library draw and for each count
 *  set — comfortably above any single card's declared amount so the outcome is
 *  never clamped by an empty zone. */
const LIBRARY_DEPTH = 8;
const COUNT_SET_SIZE = 3;

/** A scenario the generator built for one Effect Script: the pre-resolution
 *  state, the announced targets to push with the stack item, and the number of
 *  target slots (so the caller knows the target requirement to register). */
export interface Scenario {
    state: GameState;
    targets: TargetSelection[];
    /** Ids of the filler permanents created as announced permanent targets,
     *  indexed by target slot — assertors reading a destroy/exile outcome look
     *  the permanent up by these. */
    targetPermanentIds: Record<number, string>;
    /** The seeded source permanent (`SOURCE_PERMANENT_ID`) when an ability
     *  script acts on `$source`; absent otherwise. The caller pushes the stack
     *  item under this id instead of placing a source of its own. */
    sourcePermanentId?: string;
    /** The kind that seeded source was hydrated from — the host card's own
     *  (issue #3879). Present exactly when `sourcePermanentId` is, and what
     *  `predictAmount` reads to know whether a count set counts it. */
    sourceSpec?: SmokeSourceSpec;
    /** True when the script targets a player in at least one slot (drives the
     *  synthetic card's `targetRequirement`). */
    targetKind: "player" | "permanent" | "none";
}

/** The generator's verdict for one script: either a runnable scenario +
 *  assertions, or an explicit skip carrying a human-readable reason. A skip is
 *  surfaced by the sweep (never silently green — ADR 0045 / issue #804). */
export type Plan =
    | { kind: "run"; scenario: Scenario; assertions: Assertion[] }
    | {
          kind: "skip";
          /** The first skip's reason — the legible one-liner the sweep prints. */
          reason: string;
          /** EVERY skip the script raised, nested bodies included — see
           *  `planSmokeTest` for why the first one alone is not enough. */
          skips: SmokeSkip[];
      };

/**
 * ADR 0105 § 7.1 — the two classes of smoke skip.
 *
 * - `op-covered`: the skip is caused by the Op's OWN mechanism (it suspends for
 *   a decision, it registers a dormant shield, its outcome lands at a later
 *   step, it draws a random bit, …), identical for every card that uses the
 *   Op. The Op's permanent test is the evidence — the per-Op regime of
 *   ADR 0045 — so the skip does not withhold a Compiled Definition.
 * - `card-dependent`: the skip is caused by what the CARD's clause feeds the Op
 *   (a `$each` subject, a `$source` one the site does not seed — see
 *   `SmokeSite` — a runtime amount, a cast-time X, an object or zone the
 *   canned scenario does not seed). No Op test can speak for it; the
 *   Oracle compiler withholds the card until the emitting Grammar Rule carries
 *   a golden fixture for that form (`convex/oracle/gates.ts`).
 *
 * When a reason could be read either way it is `card-dependent`: a wrong
 * `op-covered` ships an unproven card, a wrong `card-dependent` only waits for
 * a fixture.
 */
export type SmokeSkipClass = "op-covered" | "card-dependent";

/** Every skip reason's category. A new skip site names one of these; a new
 *  category is added HERE, where `SMOKE_SKIP_CLASS` forces it to be classed. */
export const SMOKE_SKIP_CODES = [
    // ── op-covered ──
    "suspends-for-input",
    "dormant-shield",
    "later-outcome",
    "randomness",
    "visibility-only",
    "untapped-seed",
    "runtime-branch",
    "op-own-tests",
    // ── card-dependent ──
    "source-or-each-subject",
    "runtime-amount",
    "cast-time-x",
    "target-slot-shape",
    "choice-binding",
    "unmodelled-object-or-zone",
    "unanalysed",
    "no-assertable-outcome",
    "card-paired-mechanism",
] as const;

export type SmokeSkipCode = (typeof SMOKE_SKIP_CODES)[number];

/** The exhaustive classification — a `Record`, so a code with no class is a
 *  type error rather than a silent default. */
export const SMOKE_SKIP_CLASS: Record<SmokeSkipCode, SmokeSkipClass> = {
    "suspends-for-input": "op-covered",
    "dormant-shield": "op-covered",
    "later-outcome": "op-covered",
    randomness: "op-covered",
    "visibility-only": "op-covered",
    "untapped-seed": "op-covered",
    "runtime-branch": "op-covered",
    "op-own-tests": "op-covered",
    "source-or-each-subject": "card-dependent",
    "runtime-amount": "card-dependent",
    "cast-time-x": "card-dependent",
    "target-slot-shape": "card-dependent",
    "choice-binding": "card-dependent",
    "unmodelled-object-or-zone": "card-dependent",
    unanalysed: "card-dependent",
    "no-assertable-outcome": "card-dependent",
    // The Op's outcome depends on how the CARD pairs it — with an earlier
    // arming Op (`returnExiledForSource`, `unattach`, a captured binding) or
    // with a per-card pile protocol (`divideIntoPiles`) — so no Op test can
    // vouch for a given card's pairing.
    "card-paired-mechanism": "card-dependent",
};

/** One reason a script could not be scenario-ized. */
export interface SmokeSkip {
    readonly code: SmokeSkipCode;
    readonly reason: string;
    /** The Op being analysed when the skip was raised; absent for a
     *  script-level skip (target-slot layout, no assertable outcome). */
    readonly op?: EffectOp;
}

/** One derived declared-outcome check: a label (for a legible failure) and a
 *  predicate over the POST-resolution state. Built from a single Op before the
 *  script runs, capturing the expected delta. */
export interface Assertion {
    label: string;
    check: (post: GameState) => { ok: boolean; detail?: string };
}

/** A player Op parameter the generator can set up a scenario for. Refs and
 *  bound players require a snapshot the generator does not model, so a script
 *  using them for a PLAYER position is skipped (its outcome would be
 *  unpredictable without simulating the bind). Relative and target players are
 *  fine. */
function resolveScenarioPlayer(ref: EffectPlayerRef): string | "skip" | "ref" {
    if (ref === "controller") return CASTER_ID;
    if (ref === "opponent") return OPPONENT_ID;
    if ("target" in ref) return "target"; // a targeted player slot
    // `{ controllerOf }` — the controller of a targeted object, unknown until
    // the object is set up; treated like a ref (runtime-dependent).
    return "ref"; // { ref } / { controllerOf } — depends on runtime state
}

/** Reads player id for the ASSERTION (post-run) — same rules, but a targeted
 *  player is always the opponent in the generator's canned setup (the only
 *  player we announce as a target). */
function assertionPlayerId(ref: EffectPlayerRef): string {
    if (ref === "controller") return CASTER_ID;
    return OPPONENT_ID; // "opponent" and { target } both resolve to p2 here
}

function findPlayer(state: GameState, id: string) {
    return state.players.find((p) => p.id === id)!;
}

/** Spawns `n` filler creatures owned/controlled by `owner` in `zone`, using the
 *  generic filler card (the target / library filler). */
function spawnFiller(
    owner: string,
    zone: CardInstanceState["zone"],
    n: number,
    prefix: string
): CardInstanceState[] {
    return spawnMatching(FILLER_CARD_ID, owner, zone, n, prefix);
}

function spawnMatching(
    cardId: string,
    owner: string,
    zone: CardInstanceState["zone"],
    n: number,
    prefix: string
): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(cardId, {
            id: `${prefix}-${owner}-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone,
        })
    );
}

/** Registers (idempotently) and returns the id of a filler card whose card
 *  DEFINITION satisfies a count set's filter. Both count branches read the
 *  definition's `types` / `subtypes` (`getGraveyardCards` reads the definition,
 *  `getBattlefieldIds` matches live instance state hydrated from it), so the
 *  seeded set is counted only when the definition matches — a generic vanilla
 *  bear would silently count as zero against a "for each Shrine" filter. */
function countFillerId(filter: {
    type?: string | string[];
    subtype?: string | string[] | { ref: string };
}): string {
    // issue #677 — `type`/`subtype` may be an OR-array; a single representative
    // filler matching the FIRST value is enough for a canned scenario's count.
    const type =
        (Array.isArray(filter.type) ? filter.type[0] : filter.type) ??
        "Creature";
    // issue #3721 — a `{ ref }` subtype names a `chooseCreatureType` binding,
    // so there is no literal to build a filler for. Falls back to the generic
    // filler subtype; the script carrying such a filter also carries the
    // suspending Op, which `analyseOp` skips wholesale, so this branch only
    // keeps the type honest rather than serving a live scenario.
    const literalSubtype =
        typeof filter.subtype === "object" && !Array.isArray(filter.subtype)
            ? undefined
            : filter.subtype;
    const subtype =
        (Array.isArray(literalSubtype) ? literalSubtype[0] : literalSubtype) ??
        FILLER_SUBTYPE;
    const id = `gen-count-filler-${type}-${subtype}`;
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { C: 1 },
        types: [type as CardInstanceState["types"][number]],
        subtypes: [subtype],
        ...(type === "Creature" ? { power: 1, toughness: 1 } : {}),
    });
    return id;
}

/** Registers (idempotently) and returns the id of the card DEFINITION the
 *  seeded SOURCE permanent is hydrated from: the host card's own types,
 *  subtypes and P/T (issue #3879). Keyed on the kind itself, so two hosts of
 *  the same kind share one registration and two of different kinds can never
 *  collide — the `countFillerId` pattern, one object over. */
function sourceCardId(source: SmokeSourceSpec): string {
    const types = [...source.types];
    const subtypes = [...(source.subtypes ?? [])];
    // The two groups are separated by `|`, never by the same `-` that joins
    // within a group: `types:["Creature"] subtypes:["Wall","X"]` and
    // `types:["Creature","Wall"] subtypes:["X"]` are different kinds and must
    // not mint one id (last registration would win).
    const id = `gen-source-${types.join("-")}|${subtypes.join("-")}|${source.power ?? "x"}/${source.toughness ?? "x"}`;
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { C: 1 },
        types,
        subtypes,
        ...(source.power === undefined ? {} : { power: source.power }),
        ...(source.toughness === undefined
            ? {}
            : { toughness: source.toughness }),
    });
    return id;
}

// --- Requirement analysis ---------------------------------------------------

/** Accumulated scenario requirements gathered while walking the Ops. */
interface Requirements {
    /** Announced target slots the script reads, keyed by slot index; value is
     *  the kind that slot must be. A slot read as both is a conflict. */
    targetSlots: Map<number, "player" | "permanent">;
    /** Players who must be able to draw (need a stocked library). */
    drawingPlayers: Set<string>;
    /** Count sets to populate so a `count` value is non-zero. */
    countSets: EffectCountSpec[];
    /** Every reason the script cannot be scenario-ized; empty when it can. */
    skips: SmokeSkip[];
    /** The host of the script — whether `$source` names a permanent, what that
     *  permanent IS, and whether it is still on the battlefield at resolution
     *  (issue #3879). */
    host: SmokeHost;
    /** An Op acts on `$source`: seed the source permanent. */
    sourceSubject: boolean;
    /** The tap state an Op drives `$source` to. An untap seeds the source
     *  tapped, so the untap has an outcome to observe. */
    sourceTapAction?: "tap" | "untap";
    /** The Op `analyseOp` is walking — stamped on each skip it raises. */
    currentOp?: EffectOp;
}

function skipBecause(
    req: Requirements,
    code: SmokeSkipCode,
    reason: string
): void {
    req.skips.push(
        req.currentOp === undefined
            ? { code, reason }
            : { code, reason, op: req.currentOp }
    );
}

/** Every Op and construct name the Effect Script DSL knows — what separates a
 *  nested Op from a comparison predicate's `op: "gt"`. */
const EFFECT_OP_NAMES: ReadonlySet<string> = new Set(
    EFFECT_OP_REGISTRY.map((row) => row.op)
);

function isEffectOp(node: unknown): node is EffectOp {
    return (
        typeof node === "object" &&
        node !== null &&
        !Array.isArray(node) &&
        EFFECT_OP_NAMES.has(String((node as { op?: unknown }).op))
    );
}

/** Fields typed `EffectValue` somewhere in the `EffectOp` union — an amount. */
const AMOUNT_KEYS: ReadonlySet<string> = new Set([
    "amount",
    "count",
    "costPerKept",
    "look",
    "max",
    "min",
    "take",
    "energyEqualTo",
    "genericEqualTo",
    "left",
    "right",
    "negate",
    "power",
    "toughness",
    "reducedBy",
]);

/**
 * ADR 0105 § 7.1 — what an `op-covered` skip must NOT hide: the card-dependent
 * parts of the Op's OWN arguments. An op-covered branch of `analyseOp` stops
 * at the Op's mechanism ("registers a dormant shield") and returns before it
 * reads the subject or the amount, so "Regenerate this creature" and
 * "Regenerate target creature" raise the same op-covered skip — yet the first
 * acts on `$source`, which is exactly what ADR 0105 § 7.1 names as
 * card-dependent. This walk reads those arguments back, fail-closed: any
 * runtime amount and any object ref is card-dependent. Nested Op arrays are
 * left to `nestedOps`, which analyses each nested Op on its own.
 */
function analyseOwnArguments(op: EffectOp, req: Requirements): void {
    const walk = (node: unknown, key: string | null): void => {
        if (Array.isArray(node)) {
            for (const child of node) if (!isEffectOp(child)) walk(child, key);
            return;
        }
        if (node === null || typeof node !== "object") return;
        if (key !== null && AMOUNT_KEYS.has(key)) {
            // Fail-closed: a non-numeric amount is card-dependent whatever
            // its shape. `analyseValue` names the reason when it knows the
            // value; an object it does not know (it may throw on one — it is
            // written for well-typed amount sites) gets the generic reason.
            const before = req.skips.length;
            try {
                analyseValue(node as EffectValue, req);
            } catch {
                req.skips.length = before;
            }
            if (req.skips.length === before)
                skipBecause(
                    req,
                    "runtime-amount",
                    `Op "${op.op}" reads a runtime "${key}" amount — the canned generator does not size it`
                );
            return;
        }
        const record = node as Record<string, unknown>;
        if (typeof record.ref === "string") {
            if (record.ref === "$source" || record.ref === "$each")
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "${op.op}" acts on ${record.ref} — covered by the card's own per-card test`
                );
            else
                skipBecause(
                    req,
                    "runtime-amount",
                    `Op "${op.op}" reads ref "${record.ref}" — depends on a runtime binding`
                );
            return;
        }
        for (const [child, value] of Object.entries(record))
            if (!isEffectOp(value)) walk(value, child);
    };
    for (const [key, value] of Object.entries(op)) {
        if (key === "op" || isEffectOp(value)) continue;
        walk(value, key);
    }
}

/** Analyse one Op; when its own analyser raised only op-covered skips, read
 *  its arguments back so an op-covered mechanism cannot hide them. */
function analyseOpFully(op: EffectOp, req: Requirements): void {
    const before = req.skips.length;
    req.currentOp = op;
    analyseOp(op, req);
    const raised = req.skips.slice(before);
    if (
        raised.length > 0 &&
        raised.every((skip) => SMOKE_SKIP_CLASS[skip.code] === "op-covered")
    )
        analyseOwnArguments(op, req);
    req.currentOp = undefined;
}

function analyseValue(value: EffectValue, req: Requirements): void {
    if (typeof value === "number") return;
    if ("ref" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `numeric ref "${value.ref}" — amount depends on a runtime snapshot`
        );
        return;
    }
    // Chosen-cost X (issue #852): the amount is whatever was announced for {X}
    // at cast time. The canned scenario pushes the spell directly on the stack
    // without a cast, so getX() would read 0 — the declared outcome can't be
    // asserted deterministically. Skip-with-reason (the per-card test remains
    // the behavioural guarantor for X cards).
    if ("X" in value) {
        skipBecause(
            req,
            "cast-time-x",
            `amount is chosen-cost X — depends on the value announced for {X} at cast time`
        );
        return;
    }
    // counters (issue #1015, CR 122.6): the amount reads the LIVE count of a
    // counter type on a selected permanent. The canned generator does not
    // pre-seed counters on its filler permanents, so the count would be 0 and
    // the declared outcome can't be asserted deterministically. Skip-with-reason
    // — the construct's interpreter test (across $source / $each / target) is
    // the behavioural guarantor (per DSL-first authoring, new-construct regime).
    if ("counters" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads a permanent's "${value.counters.type}" counter count — the canned generator does not pre-seed counters`
        );
        return;
    }
    // kickerCount (CR 702.33): the amount reads how many times the spell was
    // kicked, a cast-time decision the canned generator (which casts unkicked)
    // can't reproduce. Skip-with-reason — the per-card / interpreter test is the
    // behavioural guarantor (per DSL-first authoring, new-construct regime).
    if ("kickerCount" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads the spell's kicker count — the canned generator casts unkicked`
        );
        return;
    }
    // additionalCostPaid (CR 702.33, ADR 0079): the amount reads whether ONE named
    // Kicker was paid — the same cast-time decision `kickerCount` reads, so the
    // canned generator (which casts unkicked) can't reproduce it either.
    if ("additionalCostPaid" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads whether the "${value.additionalCostPaid}" kicker was paid — the canned generator casts unkicked`
        );
        return;
    }
    // manaValue (CR 202.3): the amount reads a selected object's mana value. The
    // canned generator's filler permanents have no controlled mana value the
    // predictor can size a declared outcome against; skip-with-reason — the
    // per-card / interpreter test is the behavioural guarantor.
    if ("manaValue" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads a selected object's mana value — not faithfully sizable in a canned scenario`
        );
        return;
    }
    // domain (CR 702 preamble, issue #1066): the amount reads a PLAYER's
    // Domain (distinct basic land types among lands controlled). The canned
    // generator's filler board has no basic lands the predictor can size a
    // declared outcome against; skip-with-reason — the value member's own
    // interpreter test (across the `of` player selectors) is the behavioural
    // guarantor (per DSL-first authoring, new-construct regime).
    if ("domain" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads a player's Domain — the canned generator does not seed basic lands to size it`
        );
        return;
    }
    // devotion (CR 700.5, issue #2070): the amount reads a PLAYER's devotion
    // to a colour (mana symbols of that colour among controlled permanents'
    // costs). The canned generator's filler board has no colour-costed
    // permanents the predictor can size a declared outcome against;
    // skip-with-reason — the value member's own interpreter test is the
    // behavioural guarantor (per DSL-first authoring, new-construct regime).
    if ("devotion" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads a player's devotion to a colour — the canned generator does not seed costed permanents to size it`
        );
        return;
    }
    // escaped (CR 702.138b, issue #695): a 0/1 read of whether a permanent
    // escaped. The canned generator casts spells from hand, never via escape, so
    // it can't set an escaped=1 outcome; skip-with-reason — the value member's
    // own interpreter test is the behavioural guarantor (new-construct regime).
    if ("escaped" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads a permanent's escaped flag — the canned generator does not cast via escape`
        );
        return;
    }
    // abilityResolutionCount (CR 122 / 603.3, issue #1189): the amount reads
    // how many times the CURRENTLY RESOLVING triggered ability has resolved
    // this turn — meaningless outside a live trigger sequence the canned
    // single-shot generator doesn't simulate (and every real consumer lives
    // inside an `if` predicate anyway, which already skips unconditionally
    // below). Skip-with-reason — the value member's own interpreter test
    // (across the nested if/else-if/else combo) is the behavioural guarantor
    // (new-construct regime).
    if ("abilityResolutionCount" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads the resolving triggered ability's per-turn resolution count — not modelled by the canned single-shot generator`
        );
        return;
    }
    // lifeGainedThisTurn (CR 119.3, issue #1457): the amount reads how much
    // life a player has gained this turn. The canned generator opens a fresh
    // turn and never gains life before the spell resolves, so it cannot size a
    // declared outcome; skip-with-reason — the value member's own interpreter
    // test is the behavioural guarantor (new-construct regime).
    if ("lifeGainedThisTurn" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads a player's life gained this turn — the canned generator does not gain life before resolving`
        );
        return;
    }
    // cardsDrawnThisTurn (CR 121.1, issue #3240): the amount reads how many
    // cards a player has drawn this turn. The canned generator opens a fresh
    // turn and never draws before the spell resolves, so it cannot size a
    // declared outcome; skip-with-reason — the value member's own interpreter
    // test is the behavioural guarantor (new-construct regime).
    if ("cardsDrawnThisTurn" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads a player's cards drawn this turn — the canned generator does not draw before resolving`
        );
        return;
    }
    // playerCounters (CR 122.1, issue #1969): the amount reads how many
    // counters of one kind a PLAYER has. The canned generator builds a fresh
    // board and never seeds poison / energy / experience on either player, so
    // the value is always 0 there and no declared outcome can be sized off it;
    // skip-with-reason — the value member's own interpreter test is the
    // behavioural guarantor (new-construct regime).
    if ("playerCounters" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads a player's counters of one kind — the canned generator does not seed player counters`
        );
        return;
    }
    // difference (issue #2006): `from` minus `minus`. The filler seeds ONE
    // count set at COUNT_SET_SIZE and the predictor reads that fixed size back,
    // so a TWO-operand amount has no faithful prediction here — and a hand
    // operand (the shape this member exists for) is a zone the generator does
    // not own at all (see the `hand` skip below). Skip-with-reason — the
    // member's own interpreter test is the behavioural guarantor (per
    // DSL-first authoring, new-construct regime).
    if ("difference" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount is a difference of two values — the canned predictor sizes exactly one count set, not an arithmetic combination`
        );
        return;
    }
    // scaled (issue #2366): a fixed multiplier times a terminal — X, a
    // literal, or a count. When the operand is X the canned generator can't
    // reproduce the value (same reason bare `X` skips above: it pushes the
    // spell directly, never announcing X); when the operand is a count, the
    // multiplied total is a fresh magnitude `predictAmount`'s fixed
    // COUNT_SET_SIZE contract doesn't cover either. Skip-with-reason —
    // the member's own interpreter test is the behavioural guarantor
    // (new-grammar-member regime, matching `difference`'s own skip above).
    if ("scaled" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount is a scaled (multiplied) terminal — the canned predictor sizes exactly one unscaled count set`
        );
        return;
    }
    // divide (issue #2385): a terminal divided by a fixed divisor. Same
    // unmodelable-magnitude reason as `scaled` — the quotient is a fresh
    // number `predictAmount`'s fixed COUNT_SET_SIZE contract doesn't cover.
    // Skip-with-reason — the member's own interpreter test is the
    // behavioural guarantor (new-grammar-member regime).
    if ("divide" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount is a divided terminal — the canned predictor sizes exactly one undivided count set`
        );
        return;
    }
    // sacrificed (issue #2375): a characteristic of the permanent sacrificed
    // to PAY this spell/ability's additional cost, read as last known
    // information off the stack item's `additionalSacrificeSnapshot`
    // (CR 601.2f / 608.2h). The canned generator pushes the stack item
    // directly and never walks the cost-payment path, so no snapshot is ever
    // attached and the value would resolve `undefined` — a silently wrong
    // prediction rather than an honest one. Skip-with-reason, exactly as the
    // other post-`X` grammar members above; the member's own interpreter test
    // is the behavioural guarantor (new-grammar-member regime).
    if ("sacrificed" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount reads the cost-sacrificed permanent's ${value.sacrificed.read} — the canned generator never pays an additional sacrifice cost, so no snapshot exists to read`
        );
        return;
    }
    // sum (CR 122 / 404, issue #3243): the total of one characteristic across a
    // SET of cards a PRECEDING Op bound (a `mill` `bindAll`, a `choice` `bind`).
    // The canned generator pushes one stack item and predicts one amount — it
    // never runs the preceding Op, so the binding is never captured and the
    // value would resolve to its empty-set 0, sizing a declared outcome at
    // nothing. Skip-with-reason, exactly as the other post-`X` grammar members
    // above; the member's own interpreter test is the behavioural guarantor
    // (new-grammar-member regime).
    if ("sum" in value) {
        skipBecause(
            req,
            "runtime-amount",
            `amount sums the ${value.sum.read} of a bound card set — the canned generator never runs the Op that binds it`
        );
        return;
    }
    // setSize (CR 107.3 / 118.12, issue #3244): the SIZE of a set a preceding
    // Op bound — `sum`'s reason exactly: the canned generator never runs the
    // binding Op, so the value would resolve to its empty-set 0.
    if ("setSize" in value) {
        skipBecause(
            req,
            "runtime-amount",
            "amount counts a bound set — the canned generator never runs the Op that binds it"
        );
        return;
    }
    req.countSets.push(value.count);
    // A count set's own controller may itself be a ref — unmodelable.
    const c = value.count.controller;
    if (typeof c === "object" && c !== null && "ref" in c) {
        skipBecause(
            req,
            "runtime-amount",
            `count set controller is a ref "${c.ref}"`
        );
    }
    // issue #985 — the filler seeds ONE player's zone with cards matched by
    // type/subtype only. An `acrossAllPlayers` scope (every graveyard) or a
    // `name` filter (an exact printed name the filler doesn't synthesize) can't
    // be faithfully sized here; skip-with-reason so a hand-written test is the
    // behavioural guarantor (per DSL-first authoring, new-construct regime).
    if (value.count.acrossAllPlayers) {
        skipBecause(
            req,
            "runtime-amount",
            `count set spans all players' zones — not faithfully sizable in a canned scenario`
        );
    }
    // issue #783 — the MIN-across-players sibling of `acrossAllPlayers`, and
    // the same reason: the filler seeds ONE player's zone, so the other
    // player's (unseeded, therefore 0) count would be the minimum and the
    // predicted amount would be wrong rather than skipped. Skip-with-reason —
    // the construct's hand-written interpreter test is the guarantor.
    if (value.count.smallestAcrossPlayers) {
        skipBecause(
            req,
            "runtime-amount",
            `count set takes the SMALLEST count across all players' zones — not faithfully sizable in a canned scenario`
        );
    }
    // issue #783 — a LIBRARY count set. The library is also the zone the
    // generator seeds for DRAWING players at a fixed depth, so its size is not
    // a free variable the count filler owns; predicting COUNT_SET_SIZE there
    // would be a silently wrong assertion (the generator's contract is an
    // explicit skip with a reason, never a silent pass).
    if (value.count.zone === "library") {
        skipBecause(
            req,
            "runtime-amount",
            `count set counts a LIBRARY — the canned generator's library depth is owned by the draw filler, not the count filler`
        );
    }
    // issue #2006 — a HAND count set, the library skip's twin. The hand is
    // seeded by the cast filler (the spell being resolved came from it), not by
    // the count filler, so predicting COUNT_SET_SIZE would be a silently wrong
    // assertion rather than an honest skip.
    if (value.count.zone === "hand") {
        skipBecause(
            req,
            "runtime-amount",
            `count set counts a HAND — the canned generator's hand contents are owned by the cast filler, not the count filler`
        );
    }
    if (value.count.filter?.name !== undefined) {
        skipBecause(
            req,
            "runtime-amount",
            `count set filters by card name "${value.count.filter.name}" — filler doesn't synthesize an exact name`
        );
    }
    // issue #999 — the filler seeds cards by type/subtype only and predicts a
    // plain cardinality. A supertype-exclusion filter ("nonbasic land") or a
    // `times` multiplier ("twice the number of …") aren't modelled by the
    // seeder/predictor, so skip-with-reason — the construct's hand-written
    // interpreter test is the behavioural guarantor (new-construct regime).
    if (value.count.filter?.excludeSupertype !== undefined) {
        skipBecause(
            req,
            "runtime-amount",
            `count set excludes supertype(s) — the filler doesn't model supertype exclusion`
        );
    }
    // issue #1952 — `countFillerId` seeds a filler card by type/subtype only
    // (`gen-count-filler-<type>-<subtype>`, no `colors`); a count filter that
    // ALSO restricts by color (Pygmy Kavu's "black creature") would silently
    // seed a colorless filler that never matches the color check, mispredicting
    // a nonzero amount as the wrong 0 instead of skipping. Same treatment as
    // `name`/`excludeSupertype` above — skip-with-reason, hand-written test is
    // the behavioural guarantor.
    if (value.count.filter?.color !== undefined) {
        skipBecause(
            req,
            "runtime-amount",
            `count set filters by color "${value.count.filter.color}" — the filler doesn't model color`
        );
    }
    if (value.count.times !== undefined) {
        skipBecause(
            req,
            "runtime-amount",
            `count set applies a ${value.count.times}× multiplier — not modelled by the canned predictor`
        );
    }
}

function analysePlayer(
    ref: EffectPlayerRef,
    slotUse: Requirements,
    forDraw: boolean
): void {
    const resolved = resolveScenarioPlayer(ref);
    if (resolved === "ref") {
        skipBecause(
            slotUse,
            "runtime-amount",
            `player parameter is a ref — recipient depends on a runtime snapshot`
        );
        return;
    }
    if (resolved === "target") {
        // A targeted player slot — record it as a player slot.
        const slot = (ref as { target: number }).target;
        recordSlot(slotUse, slot, "player");
        if (forDraw) slotUse.drawingPlayers.add(OPPONENT_ID);
        return;
    }
    if (forDraw) slotUse.drawingPlayers.add(resolved);
}

function recordSlot(
    req: Requirements,
    slot: number,
    kind: "player" | "permanent"
): void {
    const existing = req.targetSlots.get(slot);
    if (existing && existing !== kind) {
        skipBecause(
            req,
            "target-slot-shape",
            `target slot ${slot} is read as both ${existing} and ${kind}`
        );
        return;
    }
    req.targetSlots.set(slot, kind);
}

function isSourceRef(selector: EffectObjectSelector): boolean {
    return "ref" in selector && selector.ref === "$source";
}

/** The source spec of the script's host, when it has one that the canned
 *  scenario can seed: an ability site whose source is still on the battlefield
 *  at resolution. Undefined at a spell site and for a source that has left
 *  (issue #3879). */
function seedableSource(req: Requirements): SmokeSourceSpec | undefined {
    if (req.host.site !== "ability") return undefined;
    return req.host.source.onBattlefieldAtResolution
        ? req.host.source
        : undefined;
}

/** True when the canned scenario can seed the object `selector` names: an
 *  announced target slot, or — at an ability site whose source is on the
 *  battlefield at resolution — the ability's own source permanent (issue
 *  #3831 / #3879). `$each` (a runtime-selected `forEach` member), a spell-site
 *  `$source` and a `$source` that is no longer a permanent when the ability
 *  resolves (CR 608.2h) are not modelled. */
function subjectModelled(
    req: Requirements,
    selector: EffectObjectSelector
): boolean {
    return (
        "target" in selector ||
        (isSourceRef(selector) && seedableSource(req) !== undefined)
    );
}

/**
 * Ops whose subject must be a CREATURE for the canned run to prove anything.
 *
 * No CR rule makes these primitives creature-only — the Oracle sentences they
 * were written for say "that creature", and `setExileOnDeath`,
 * `setDamageLockThisTurn` and `setTargetCantBeRegeneratedThisTurn`
 * (`gre/state.ts`) each encode that by returning early on a permanent whose
 * card types do not include Creature. `pump` is here for a different reason:
 * its assertion is a power/toughness read, and only a creature card has power
 * and toughness (CR 208.1).
 *
 * Against the generic filler creature every one of them looked green whatever
 * the real host was (issue #3879). With the host's own kind seeded, a
 * non-creature host is a card-dependent skip instead: the Op would do nothing,
 * so there is no outcome for the canned run to prove.
 */
const OPS_REQUIRING_A_CREATURE_SUBJECT: ReadonlySet<string> = new Set([
    "exileOnDeath",
    "lockDamage",
    "preventRegeneration",
    "pump",
]);

/** Records the permanent subject of an Op `subjectModelled` accepted. The
 *  skip REASONS at the call sites still read "targets $source/$each" although
 *  only `$each` (or a spell site) can reach them: `smokeSkipForm` hashes the
 *  reason, so rewording one invalidates every golden fixture whose form it
 *  spells (ADR 0137). */
function recordSubject(
    req: Requirements,
    selector: EffectObjectSelector
): void {
    if ("target" in selector) {
        recordSlot(req, selector.target, "permanent");
        return;
    }
    // The ONE funnel every accepted `$source` subject goes through, which is
    // why the kind check lives here rather than in each Op's branch: a branch
    // that forgot it would seed a source its Op cannot act on. A skip recorded
    // here aborts the plan in `buildScenario`, exactly like any other.
    const source = seedableSource(req);
    const op = req.currentOp;
    if (source === undefined || op === undefined) {
        // Unreachable while every call site is gated by `subjectModelled` —
        // and a skip rather than an acceptance, because in a fail-closed
        // module the branch that cannot answer must be the one that withholds.
        skipBecause(
            req,
            "source-or-each-subject",
            "a $source subject reached the scenario with no seeded source"
        );
        return;
    }
    if (
        OPS_REQUIRING_A_CREATURE_SUBJECT.has(op.op) &&
        !source.types.includes("Creature")
    ) {
        skipBecause(
            req,
            "source-or-each-subject",
            `Op "${op.op}" acts on a $source its host makes a non-creature (${source.types.join("/")}) — the primitive refuses it, so the canned run has no outcome to assert`
        );
        return;
    }
    req.sourceSubject = true;
}

/** The seeded permanent an Op's subject names in the built scenario, or
 *  undefined when the scenario seeded none for it (`$each`, a spell-site
 *  `$source` — skipped upstream in `analyseOp`). */
function subjectPermanentId(
    scenario: Scenario,
    selector: EffectObjectSelector
): string | undefined {
    if ("target" in selector)
        return scenario.targetPermanentIds[selector.target];
    return isSourceRef(selector) ? scenario.sourcePermanentId : undefined;
}

/** Walks a single Op, recording what the scenario must provide. Unknown Op
 *  kinds (no analyser branch) force a skip so a new Op cannot silently pass. */
function analyseOp(op: EffectOp, req: Requirements): void {
    switch (op.op) {
        case "dealDamage":
            analyseValue(op.amount, req);
            if ("player" in op.to) {
                analysePlayer(op.to.player, req, false);
            } else if ("target" in op.to) {
                recordSlot(req, op.to.target, "permanent");
            } else if ("attackTargetOf" in op.to) {
                // CR 506.2 (issue #3244) — the recipient is whatever the
                // creature is attacking, and the canned generator declares no
                // combat.
                skipBecause(
                    req,
                    "unmodelled-object-or-zone",
                    "recipient is the player or planeswalker a creature is attacking — the canned generator declares no combat"
                );
            } else {
                // `{ ref: "$each" }` — only reachable inside a forEach body,
                // and forEach scripts are skipped wholesale below.
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `object ref "${op.to.ref}" — recipient depends on a forEach iteration`
                );
            }
            return;
        case "dealDamageDividedAsChosen":
            // CR 601.2d — the per-target split is chosen at ANNOUNCEMENT and
            // snapshotted onto the stack item's `targetAmounts`. The auto-
            // scenario has no way to populate that multi-target division, so it
            // cannot faithfully assert the per-target outcome. Covered by the
            // hand-written interpreter test instead (skip-only, like exile).
            skipBecause(
                req,
                "target-slot-shape",
                "dealDamageDividedAsChosen — announced multi-target division cannot be scenario-ized"
            );
            return;
        case "draw":
            analysePlayer(op.player, req, true);
            analyseValue(op.count, req);
            return;
        case "gainLife":
        case "loseLife":
        case "addPlayerCounter":
            analysePlayer(op.player, req, false);
            analyseValue(op.amount, req);
            return;
        case "extraTurn":
            // CR 500.7 (issue #686) — scheduling an extra turn mutates
            // `state.extraTurns`, a queue the turn-advance machinery (not the
            // stack-resolution scenario harness) later drains — not a
            // same-step observable outcome this generator can size a
            // deterministic assertion against. Covered instead by the Op's
            // own hand-written interpreter test plus Time Warp's card test
            // (tmp/__tests__/blue.test.ts).
            skipBecause(
                req,
                "later-outcome",
                `Op "extraTurn" mutates a turn-boundary queue, not a same-step outcome — covered by hand-written tests`
            );
            return;
        case "extraCombat":
            // CR 500.8 (issue #2886) — queueing an extra combat phase mutates
            // `state.extraPhases`, drained by the PHASE-advance machinery (not
            // the stack-resolution scenario harness) at a LATER END_OF_COMBAT
            // exit — not a same-step observable outcome this generator can
            // size a deterministic assertion against. Same explicit skip
            // `extraTurn` takes; covered instead by the Op's own hand-written
            // interpreter + wire-format tests and the extra-phase seam tests
            // (`gre/__tests__/extraPhases.test.ts`).
            skipBecause(
                req,
                "later-outcome",
                `Op "extraCombat" mutates a turn-structure queue, not a same-step outcome — covered by hand-written tests`
            );
            return;
        case "skipNextTurn":
            // CR 614.10 (issue #1957) — skipping a turn mutates the target
            // player's pending-skip COUNT, drained by the turn-advance
            // machinery (not the stack-resolution scenario harness) at a
            // LATER turn boundary — not a same-step observable outcome this
            // generator can size a deterministic assertion against. Covered
            // instead by the Op's own hand-written interpreter test plus
            // Waterspout Elemental's card test (pls/__tests__/blue.test.ts).
            skipBecause(
                req,
                "later-outcome",
                `Op "skipNextTurn" mutates a turn-boundary count, not a same-step outcome — covered by hand-written tests`
            );
            return;
        case "restrictCasting":
            // CR 601.3a (issue #1057) — a turn-scoped cast lock on a player; the
            // deterministic outcome is the player id (with its optional
            // cardTypes filter, issue #1124) landing in
            // state.cannotCastSpellsThisTurn (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "grantCastTiming":
            // CR 601.3b (Teferi +1) — a per-player "cast as though flash" grant;
            // the deterministic outcome is the player id landing in
            // state.castTimingFlashGrants (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "reduceSpellCostThisTurn":
            // CR 601.2f / 514.2 (issue #3340, Urza +2) — a floating turn-scoped
            // cost reduction on the named player's casts; the deterministic
            // outcome is the entry landing in state.spellCostReductionsThisTurn
            // (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "grantSpellManaSubstitution":
            // CR 609.4b / 118.14 (issue #2890, North Star) — a per-player
            // one-shot "spend mana as though any type/color" grant; the
            // deterministic outcome is the player id landing in
            // state.spellManaSubstitutionGrants (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "grantManaSubstitution":
            // CR 609.4b / 514.2 (issue #3811, False Dawn) — a per-player
            // until-end-of-turn "spend `from` mana as though any color" grant;
            // the deterministic outcome is the entry landing in
            // state.manaSubstitutionGrantsThisTurn (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "replaceManaProductionColor":
            // CR 614.1a / 514.2 (issue #3811, False Dawn) — a per-player
            // until-end-of-turn production-colour replacement; the
            // deterministic outcome is the colour landing in
            // state.manaProductionColorThisTurn (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "restrictActivation":
            // CR 602.1 / 605.1a (issue #1124) — a turn-scoped ability-activation
            // lock on a player; the deterministic outcome is the player id
            // landing in state.cannotActivateAbilitiesThisTurn (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "skipDrawStepThisTurn":
            // CR 504.1 (issue #1097 — Elfhame Sanctuary) — a one-shot
            // draw-step-skip flag on a player; the deterministic outcome is
            // the player id landing in state.skipDrawStepThisTurn (asserted
            // below). The shipped card always wraps this Op behind a
            // `mayPay`, which already skips the WHOLE script upstream — this
            // case only fires for a hypothetical future card that uses the
            // Op bare.
            analysePlayer(op.player, req, false);
            return;
        case "grantGraveyardPlay":
            // CR 305.1-analog / 601 (issue #1149) — a turn-scoped graveyard
            // play/cast permission grant on a player; the deterministic
            // outcome is the player id (with its actions/maxManaValue) landing
            // in state.graveyardPlayPermissionThisTurn (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "armGraveyardRedirect":
            // CR 614 (issue #1145 / #1149) — a turn-scoped graveyard-bound
            // redirect grant on a player; the deterministic outcome is the
            // player id landing in state.graveyardBoundRedirectThisTurn
            // (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "addMana":
            // CR 106.1 (issue #850) — mana added to a player's pool is a
            // deterministic same-resolution outcome. The default recipient is
            // the resolving controller (a ritual); a ref player is unmodelable
            // (analysePlayer records the skip).
            analysePlayer(op.player ?? "controller", req, false);
            return;
        case "destroy":
        case "exile":
            if ("target" in op.target) {
                recordSlot(req, op.target.target, "permanent");
            } else {
                // `{ ref: "$each" }` — forEach-body only; see the forEach
                // skip below.
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `object ref "${op.target.ref}" — target depends on a forEach iteration`
                );
            }
            return;
        case "exileWithAttachments":
            // CR 603.7a / 701.13 / ADR 0028 — the exile half moves the target
            // into an `exileHeld` exile-and-return BUNDLE, not the plain exile
            // zone the generator's board-delta assertion models; and the
            // OBSERVABLE outcome (the host coming back re-attached with its
            // noted counters) only manifests when the SOURCE later leaves /
            // untaps and the paired `returnExiledForSource` fires — a second
            // step the canned single-resolution generator does not sequence.
            // Explicit skip — the exile/return round-trip is covered by the
            // Op's own hand-written interpreter + card tests (per-Op regime).
            skipBecause(
                req,
                "later-outcome",
                `Op "exileWithAttachments" arms an exile-and-return bundle whose observable outcome needs a later source-leaves/untaps return — covered by the Op's interpreter tests`
            );
            return;
        case "exileSelf":
            // CR 608.2 (issue #1097) — redirects the RESOLVING spell's own
            // destination from graveyard to exile. The canned generator's
            // assertion vocabulary (battlefield/graveyard/life/counter deltas)
            // has no hook for "where did the resolving spell card itself
            // land" — same rationale as `shuffleSelfIntoLibrary` below, just a
            // different destination zone. Explicit skip — covered by the Op's
            // own interpreter tests (per-Op regime).
            skipBecause(
                req,
                "op-own-tests",
                `Op "exileSelf" redirects the resolving spell's own destination to exile — covered by the Op's interpreter tests`
            );
            return;
        case "returnExiledForSource":
            // CR 603.7a / ADR 0028 — the return half only has an observable
            // outcome if a PRIOR `exileWithAttachments` already armed a bundle
            // for the SAME source, which the canned generator doesn't
            // sequence (same rationale as `unattach` after `attach`). Explicit
            // skip — covered by the Op's own hand-written interpreter tests.
            skipBecause(
                req,
                "card-paired-mechanism",
                `Op "returnExiledForSource" only has an observable outcome after a prior exileWithAttachments armed a bundle — covered by the Op's interpreter tests`
            );
            return;
        case "captureBinding":
        case "recallCapturedBinding":
            // CR 608.2h / 400.7 (issue #2384) — the pair's whole point is that
            // the write and the read happen in TWO SEPARATE resolutions of two
            // DIFFERENT abilities of the same source, arbitrarily far apart. A
            // canned scenario resolves one stack item, so it can neither set up
            // the earlier ability nor observe a later one — there is no
            // same-resolution outcome to assert. Explicit skip; covered by the
            // Ops' own hand-written interpreter tests (per-Op regime).
            skipBecause(
                req,
                "card-paired-mechanism",
                `Op "${op.op}" spans two separate resolutions of the same source's abilities — covered by the Op's interpreter tests`
            );
            return;
        case "attach":
            // CR 701.3a (ADR 0065, issue #1311) — Reconfigure's attach Op
            // requires "target creature YOU control" (Lion Sash), unlike the
            // generic-permanent targets `destroy`/`exile` model above; the
            // canned generator's target placement (opponent's battlefield)
            // can't satisfy a controller-scoped target requirement. Explicit
            // skip — a genuinely NEW Op earns the full per-Op interpreter +
            // card test regime instead (`.claude/rules/gre-development.md`).
            skipBecause(
                req,
                "unmodelled-object-or-zone",
                `Op "attach" targets a creature the CONTROLLER controls — not modelable by the generator's opponent-battlefield target placement`
            );
            return;
        case "unattach":
            // CR 701.3d (ADR 0065, issue #1311) — no target, but its outcome
            // (clearing $source's own attachedTo + restoring its Creature
            // type) is only observable if a PRIOR attach already ran in the
            // same script, which the generator doesn't sequence. Explicit
            // skip alongside "attach" — same per-Op test regime applies.
            skipBecause(
                req,
                "card-paired-mechanism",
                `Op "unattach" only has an observable outcome after a prior attach — covered by hand-written interpreter/card tests`
            );
            return;
        case "choice":
            // A `choice` Op suspends resolution for a live player decision
            // (issue #805) — a canned scenario cannot submit picks, so the
            // script is reported as an explicit skip and execution coverage
            // comes from the card's own tests (per the DSL testing regime,
            // choice-carrying cards keep full per-card coverage).
            skipBecause(
                req,
                "suspends-for-input",
                `Op "choice" suspends for player input — covered by the Op's own suspension/resume tests`
            );
            return;
        case "discard":
            // `discard` either consumes a `choice` Op's picks binding (without
            // the choice's submitted picks the outcome is undefined in a
            // canned scenario — same skip rationale as `choice`) or (issue
            // #1279, `cards` omitted) discards the WHOLE hand — the generator
            // doesn't seed a specific hand to assert an emptied-hand /
            // populated-graveyard delta against, so both shapes are skipped;
            // execution coverage is the card's own per-card test (Wheel of
            // Fortune, Anje's Ravager).
            // Issue #2713 added a THIRD shape (a `filter` over the hand,
            // Cabal Therapy) — skipped for the same reason as the whole-hand
            // one: no seeded hand to assert a delta against.
            skipBecause(
                req,
                "choice-binding",
                `Op "discard" consumes a choice binding, a hand filter, or discards the whole hand — covered by the card's own suspension/resume or per-card test`
            );
            return;
        case "grantCastFromExile":
            // `grantCastFromExile` (issue #1156, Dauthi Voidwalker) consumes
            // a `choice(zone: "exile")` Op's picks binding (the exiled card
            // chosen) — without the choice's submitted picks the outcome is
            // undefined in a canned scenario, same skip rationale as
            // `discard`/`sacrifice`.
            skipBecause(
                req,
                "choice-binding",
                `Op "grantCastFromExile" consumes a choice binding — covered by the card's own suspension/resume tests`
            );
            return;
        case "grantCastFromGraveyard":
            // `grantCastFromGraveyard` (issue #1344, Malcolm; issue #1650,
            // Emry) names its card either through a choice's picks binding
            // (undefined without the choice's submitted picks) or through an
            // announced graveyard-card target slot; and its OUTCOME is a cast
            // PERMISSION stamped on a graveyard card — not a
            // battlefield/life/hand-count delta the canned generator asserts.
            // Same skip rationale as `grantCastFromExile`/`discard`.
            skipBecause(
                req,
                "choice-binding",
                `Op "grantCastFromGraveyard" grants a cast permission off a choice binding or a graveyard target — covered by the card's own tests`
            );
            return;
        case "reveal":
            // `reveal` (issue #920 / #682) stamps `knownTo` on hidden cards —
            // an information-visibility change, not a battlefield/life/hand-
            // count outcome the canned generator's assertions model. In every
            // shipped card it also precedes a `choice(zoneOwnerId: …)` Op,
            // which already forces a skip on its own — so this case never
            // needs to carry the skip alone in practice, but is explicit for
            // exhaustiveness (a reveal-only script would hit this branch).
            skipBecause(
                req,
                "visibility-only",
                `Op "reveal" changes card visibility (knownTo) — not a state change the canned generator asserts`
            );
            return;
        case "lookRandomHand":
            // `lookRandomHand` (Urza's Bauble) grants PRIVATE knowledge of a
            // random hand card to the looker — an information-visibility change
            // (like `reveal`), not a battlefield/life/hand-count outcome the
            // canned generator's assertions model. Explicit skip for
            // exhaustiveness; execution coverage is the Op's interpreter tests.
            skipBecause(
                req,
                "visibility-only",
                `Op "lookRandomHand" changes card visibility (knownTo) — not a state change the canned generator asserts`
            );
            return;
        case "lookHand":
            // `lookHand` (issue #2383, Elite Spellbinder) grants PRIVATE
            // knowledge of a WHOLE hand to the looker — the same
            // information-visibility change as `lookRandomHand` above and
            // `reveal` before it, not a battlefield/life/hand-count outcome the
            // canned generator's assertions model. Explicit skip for
            // exhaustiveness; execution coverage is the Op's interpreter tests.
            skipBecause(
                req,
                "visibility-only",
                `Op "lookHand" changes card visibility (knownTo) — not a state change the canned generator asserts`
            );
            return;
        case "payVariableMana":
            // CR 107.3f (issue #1701) — a `payVariableMana` Op suspends
            // resolution for a live amount nomination, which a canned scenario
            // cannot submit any more than it can answer a Pay/Skip prompt
            // below. Explicit skip; execution coverage is the Op's own
            // interpreter tests, which drive the nominate → pay → bound-value
            // round trip and the amount-0 decline.
            skipBecause(
                req,
                "suspends-for-input",
                `Op "payVariableMana" suspends for a variable mana-payment nomination — covered by the Op's interpreter tests`
            );
            return;
        case "chooseNumber":
            // CR 107.1c (issue #1421) — the bare nomination suspends for the
            // same reason its paying sibling above does: the canned generator
            // has no way to answer a live "choose a number" prompt. Explicit
            // skip; execution coverage is the Op's own interpreter tests,
            // which drive the nominate → bound-value round trip, the
            // authored-range clamp and the open-ended shape.
            skipBecause(
                req,
                "suspends-for-input",
                `Op "chooseNumber" suspends for a numeric nomination — covered by the Op's interpreter tests`
            );
            return;
        case "mayPay":
            // A `mayPay` Op suspends resolution for a live Pay/Skip decision
            // (issue #806) — a canned scenario cannot submit an answer, so the
            // script is reported as an explicit skip; execution coverage comes
            // from the card's own suspension/resume tests.
            skipBecause(
                req,
                "suspends-for-input",
                `Op "mayPay" suspends for a Pay/Skip decision — covered by the Op's own suspension/resume tests`
            );
            return;
        case "scryReorder":
            // A `scryReorder` Op suspends resolution for a live order-top drag
            // decision (issue #885) — a canned scenario cannot submit the
            // ordering, so the script is reported as an explicit skip;
            // execution coverage comes from the Op's own interpreter tests and
            // the migrated cards' suspension/resume tests (per-Op regime).
            skipBecause(
                req,
                "suspends-for-input",
                `Op "scryReorder" suspends for a look/reorder-top choice — covered by the Op's interpreter tests and the card's suspension/resume tests`
            );
            return;
        case "exileTopOfLibrary":
            // CR 701.13 (issue #3235) — exiles the top N library cards. Same
            // disposition as `mill` below and for the same reason: the canned
            // generator seeds only a minimal filler library, so there is no
            // meaningful before/after library→exile delta to assert without
            // inventing a deck. A DELIBERATE, surfaced skip; execution coverage
            // is the Op's own interpreter tests.
            skipBecause(
                req,
                "op-own-tests",
                `Op "exileTopOfLibrary" moves top-of-library cards to exile — covered by the Op's interpreter tests`
            );
            return;
        case "mill":
            // `mill` (issue #885) moves the top N library cards to a graveyard.
            // The canned generator seeds only a minimal filler library and does
            // not model milling a TARGET player's deck, so rather than
            // mis-assert a graveyard delta it reports an explicit skip;
            // execution coverage is the Op's own interpreter tests.
            skipBecause(
                req,
                "op-own-tests",
                `Op "mill" moves top-of-library cards to the graveyard — covered by the Op's interpreter tests`
            );
            return;
        case "revealTopAndRoute":
            // `revealTopAndRoute` routes the revealed top card(s) by their own
            // characteristics. The canned generator seeds only a minimal filler
            // library and cannot provision a KNOWN top card matching (or
            // deliberately missing) a route's filter, so every destination is
            // unpredictable from here — asserting any delta would mis-assert.
            // Reported as an explicit skip; execution coverage is the Op's own
            // interpreter tests, which drive both the matching and the
            // fallback branch.
            skipBecause(
                req,
                "op-own-tests",
                `Op "revealTopAndRoute" routes the revealed top card by its characteristics — the canned generator cannot provision a known top card; covered by the Op's interpreter tests`
            );
            return;
        case "revealUntilMatch":
            // `revealUntilMatch` reveals from the top UNTIL a card matching the
            // filter appears, so the size of the revealed prefix — and whether
            // there is a match at all — is decided entirely by the library the
            // generator seeds. The canned generator seeds only a minimal filler
            // library and cannot provision a KNOWN library composition, so both
            // the prefix length and every destination are unpredictable from
            // here and any delta would be a mis-assertion. Reported as an
            // explicit skip; execution coverage is the Op's own interpreter
            // tests, which drive the match, the no-match and the empty-library
            // branches.
            skipBecause(
                req,
                "op-own-tests",
                `Op "revealUntilMatch" reveals a prefix whose size depends on the library composition — the canned generator cannot provision a known library; covered by the Op's interpreter tests`
            );
            return;
        case "discardAtRandom":
            // `discardAtRandom` (CR 701.9a) removes `count` RANDOM cards from a
            // TARGET player's hand. The canned generator seeds only a minimal
            // filler hand and does not provision a target player's hand with a
            // known count, so rather than mis-assert a hand-size delta it
            // reports an explicit skip; execution coverage is the Op's own
            // interpreter tests plus the migrated cards' per-card tests.
            skipBecause(
                req,
                "randomness",
                `Op "discardAtRandom" picks the discarded cards at random (seeded PRNG) — covered by the Op's interpreter tests`
            );
            return;
        case "randomExileToHand":
            // `randomExileToHand` (CR 400.7, issue #1947) picks a RANDOM
            // card from a source-linked exile pile. The canned generator
            // does not provision a linked exile pile with known contents,
            // so which card (if any) gets picked is unpredictable from
            // here — reported as an explicit skip; execution coverage is
            // the Op's own interpreter tests.
            skipBecause(
                req,
                "randomness",
                `Op "randomExileToHand" picks a random card from a source-linked exile pile — the canned generator does not provision the pile; covered by the Op's interpreter tests`
            );
            return;
        case "lookDistribute":
            // A `lookDistribute` Op suspends resolution for a live look-distribute
            // pick (issue #984) — a canned scenario cannot submit the
            // hand/bottom choice, so the script is reported as an explicit skip;
            // execution coverage comes from the Op's own interpreter tests and
            // the migrated cards' suspension/resume tests (per-Op regime).
            skipBecause(
                req,
                "suspends-for-input",
                `Op "lookDistribute" suspends for a look-distribute pick — covered by the Op's interpreter tests`
            );
            return;
        case "hideaway":
            // CR 702.75a (issue #783) — same shape as `lookDistribute`: the Op
            // suspends on a live look-distribute pick that a canned scenario
            // cannot submit, and its outcome (a FACE-DOWN exile whose identity
            // is per-viewer) is not a state delta the generator asserts.
            // Explicit skip; execution coverage is the Op's own interpreter
            // tests plus the wire-format both-viewpoints assertion.
            skipBecause(
                req,
                "suspends-for-input",
                `Op "hideaway" suspends for a look-distribute pick and exiles face down — covered by the Op's interpreter tests`
            );
            return;
        case "revealAndCategorize":
            // Same shape as `lookDistribute` (issue #1364): the Op suspends on a
            // live categorized look-distribute pick, which a canned scenario
            // cannot submit. Explicit skip; execution coverage is the Op's own
            // interpreter tests plus the categorizedPick matching unit tests.
            skipBecause(
                req,
                "suspends-for-input",
                `Op "revealAndCategorize" suspends for a categorized look-distribute pick — covered by the Op's interpreter tests`
            );
            return;
        case "chooseCategorized":
            // Same shape (issue #1945): the Op suspends on a live
            // choose-categorized pick from the chooser's hand/battlefield,
            // which a canned scenario cannot submit (a forced pick may
            // auto-resolve, but the discard/sacrifice sweep — issue #3712 —
            // and the CR 101.4 simultaneous split still need a live board the
            // canned scenario does not model). Explicit skip; execution
            // coverage is the Op's own interpreter tests plus the
            // categorizedPick matching unit tests.
            skipBecause(
                req,
                "suspends-for-input",
                `Op "chooseCategorized" suspends for a choose-categorized pick — covered by the Op's interpreter tests`
            );
            return;
        case "counter":
            // `counter` targets a SPELL on the stack (issue #806); the canned
            // generator seeds only players and battlefield permanents, not a
            // spell to counter, so it is reported as an explicit skip. Counter
            // execution is proved by the card's own resolution test.
            skipBecause(
                req,
                "unmodelled-object-or-zone",
                `Op "counter" targets a spell on the stack — covered by the card's own resolution test`
            );
            return;
        case "moveSpellFromStack":
            // `moveSpellFromStack` (issue #2605) targets a SPELL on the stack,
            // same as `counter`: the canned generator seeds only players and
            // battlefield permanents, never a second spell to move, so it is
            // reported as an explicit skip rather than silently unhandled.
            // Execution is proved by the Op's own interpreter tests.
            skipBecause(
                req,
                "op-own-tests",
                `Op "moveSpellFromStack" targets a spell on the stack — covered by the Op's interpreter tests`
            );
            return;
        case "if":
            // The `if` construct branches on a runtime predicate (issue #806).
            // The taken branch — and thus the observable outcome — depends on
            // a live may-pay outcome or a runtime snapshot the generator does
            // not model, so it is reported as an explicit skip; branch
            // execution is proved by the card's own tests.
            skipBecause(
                req,
                "runtime-branch",
                `construct "if" branches on a runtime predicate — covered by the construct's interpreter tests`
            );
            return;
        case "sacrifice":
            // `sacrifice` (issue #807) consumes a `choice` Op's picks binding
            // — same skip rationale as `discard`.
            skipBecause(
                req,
                "choice-binding",
                `Op "sacrifice" consumes a choice binding — covered by the card's own suspension/resume tests`
            );
            return;
        case "moveZone":
            // `moveZone` (issue #839) changes an object's zone. The canned
            // generator only seeds battlefield permanents and player targets —
            // it does not model a graveyard-card target's source zone, and a
            // permanent target it DID seed lives on the opponent's
            // battlefield, whereas the Op's outcome (bounce to hand,
            // reanimate, exile-from-graveyard) depends on which zone the object
            // starts in. The whole-zone bulk shape (issue #1279 — no `target`/
            // `cards`) has the same problem: the generator doesn't seed a
            // specific hand/graveyard to assert a moved-everything delta
            // against. Rather than mis-assert, report an explicit skip for
            // every shape; execution coverage is the card's own per-card test
            // (the migrated resolve()-cards keep their full behavioural
            // tests — Timetwister, Echo of Eons).
            skipBecause(
                req,
                "unmodelled-object-or-zone",
                `Op "moveZone" changes zones on an object/zone the canned generator does not model — covered by the card's own per-card test`
            );
            return;
        case "pump":
            // `pump` (issue #840) adds a temporary P/T buff (CR 613.4c). The
            // generator can assert a FIXED-amount pump on an announced
            // permanent slot (it seeds a filler creature there and reads the
            // effective P/T delta after resolution). A `$each` (or spell-site `$source`)
            // target or a `ref`/`count` amount is not modelled — skip and let
            // the card's own per-card test cover it.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "pump" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            if (
                typeof op.power !== "number" ||
                typeof op.toughness !== "number"
            ) {
                skipBecause(
                    req,
                    "runtime-amount",
                    `Op "pump" uses a ref/count P/T amount the canned generator does not model — covered by the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "counters":
            // `counters` (issue #841) puts/removes counters (CR 122). The
            // generator can assert a FIXED-count ADD on an announced permanent
            // slot (it seeds a filler creature there and reads the counter
            // tally after resolution). A `$each` (or spell-site `$source`) target, a
            // `ref`/`count` amount, or a `remove` (which needs pre-seeded
            // counters the canned generator does not place) is not modelled —
            // skip and let the card's own per-card test cover it.
            if (op.action !== "add") {
                skipBecause(
                    req,
                    "unmodelled-object-or-zone",
                    `Op "counters" removes counters the canned generator does not pre-seed — covered by the card's own per-card test`
                );
                return;
            }
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "counters" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            if (typeof op.count !== "number") {
                skipBecause(
                    req,
                    "runtime-amount",
                    `Op "counters" uses a ref/count amount the canned generator does not model — covered by the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "setLevel":
            // `setLevel` (issue #3234) sets a permanent's class level
            // (CR 716.2a). The generator can assert it on an announced
            // permanent slot (it seeds a filler permanent there — level 1 by
            // CR 716.2d, since nothing seeds a level — and reads the level
            // after resolution) and, since a class level bar is printed on the
            // Class it levels (CR 716.2a), on an ability's own `$source` —
            // against the generic filler permanent, which is what that proves
            // and all it proves: the level lands, not that a Class card's own
            // bar reads right (Stormchaser's Talent's per-card test and the
            // Op's interpreter test stay the behavioural guarantors). A `$each`
            // (or spell-site `$source`) target is not modelled.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "setLevel" targets $source/$each — covered by the Op's interpreter test and the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "tapUntap":
            // `tapUntap` (issue #842) taps/untaps a permanent (CR 701.26). The
            // generator can assert a TAP on an announced permanent slot or on
            // an ability's own source (it seeds a filler permanent there —
            // untapped by default — and reads its tap state after resolution),
            // and an UNTAP of the source, which it then seeds tapped (issue
            // #3831). An untap of an announced slot (the canned generator
            // seeds untapped permanents, so there is nothing to observe) or a
            // `$each` target is not modelled — skip and let the card's own
            // per-card test cover it.
            if (op.action !== "tap" && !isSourceRef(op.target)) {
                skipBecause(
                    req,
                    "untapped-seed",
                    `Op "tapUntap" untaps a permanent the canned generator already seeds untapped — covered by the Op's interpreter tests`
                );
                return;
            }
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "tapUntap" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            if (isSourceRef(op.target)) {
                // One seeded tap state serves one final-state assertion: a
                // script that both taps and untaps its source is order-
                // dependent, which the canned run does not model.
                if (
                    req.sourceTapAction !== undefined &&
                    req.sourceTapAction !== op.action
                ) {
                    skipBecause(
                        req,
                        "source-or-each-subject",
                        `Op "tapUntap" both taps and untaps $source — the canned run asserts one final tap state`
                    );
                    return;
                }
                req.sourceTapAction = op.action;
            }
            recordSubject(req, op.target);
            return;
        case "skipNextUntap":
            // `skipNextUntap` (PRD #795, CR 302.6/502.1) arms a one-shot
            // "doesn't untap next untap step" flag on a permanent. The
            // generator can assert it on an announced permanent slot (it seeds
            // a filler creature there and reads `skipNextUntap` after
            // resolution). A `$each` (or spell-site `$source`) target is not modelled — skip
            // and let the card's own per-card test cover it.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "skipNextUntap" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "grantAbility":
            // `grantAbility` (issue #843) grants a keyword static ability to a
            // permanent for a duration (CR 611.2a / 613.1f). The generator can
            // assert a grant on an announced permanent slot (it seeds a filler
            // creature there and reads its `staticAbilities` after resolution).
            // A `$each` (or spell-site `$source`) target is not modelled — skip and let the
            // card's own per-card test cover it.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "grantAbility" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "animate":
            // `animate` (issue #1317) turns a permanent into a creature (CR
            // 208.2 / 611.1) — potentially changing its BASIC eligibility as a
            // combat/permanent object (types, P/T, granted keywords) in a way
            // the canned generator's target-seeding (which assumes a stable
            // permanent "kind" for the whole scenario) does not model, and the
            // canonical caller (Earthbend N, Badgermole Cub) targets a LAND,
            // not the generator's default creature filler. Explicit skip — the
            // Op is new (per-Op regime, `.claude/rules/gre-development.md`)
            // and earns its own hand-written interpreter + wire-format test
            // instead of relying on the canned smoke sweep.
            skipBecause(
                req,
                "op-own-tests",
                `Op "animate" changes a permanent's basic kind (CR 205.1a/611.1) — covered by the Op's own interpreter + wire-format tests`
            );
            return;
        case "setBasePT":
            // `setBasePT` (issue #1318) sets a permanent's base P/T (CR 613.4b
            // layer 7b) for a duration. The canonical callers (Sorceress Queen,
            // Island of Wak-Wak, Singing Tree) target a creature with a
            // characteristic filter (flying / attacking) the canned generator's
            // default filler does not satisfy, and the observable outcome is an
            // effective-P/T READ that the smoke sweep's outcome vocabulary does
            // not assert. Explicit skip — the Op is new (per-Op regime) and
            // earns its own hand-written interpreter + wire-format test.
            skipBecause(
                req,
                "op-own-tests",
                `Op "setBasePT" sets base P/T (CR 613.4b) — covered by the Op's own interpreter + wire-format tests`
            );
            return;
        case "addSubtype":
            // `addSubtype` (issue #1194) adds a subtype to a permanent
            // INDEFINITELY (CR 613.1d layer 4). The generator can assert an
            // add on an announced permanent slot (it seeds a filler creature
            // there and reads `subtypes` after resolution). A `$each` (or
            // spell-site `$source`) target is not modelled — skip and let the card's own
            // per-card test cover it.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "addSubtype" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            // CR 303.4 / 704.5m — a grant that makes the target an AURA is not
            // scenarioizable: the canned scenario attaches it to nothing, so
            // the attachment SBA correctly bins it before the check can read
            // its subtypes. The observable outcome there is the attachment
            // itself, which needs the effect's own `attach` leg.
            if (op.subtype === "Aura" || op.enchantRestriction) {
                skipBecause(
                    req,
                    "unmodelled-object-or-zone",
                    `Op "addSubtype" grants the Aura subtype (CR 303.4) — attachment is not modelled by the canned scenario`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "setColor":
            // `setColor` (issue #1083) sets colorOverride (CR 613.1e layer
            // 5). Every shipped INV card composes it inside a suspending
            // `optionChoice` ("choose a color, then set it") or a `forEach {
            // set: "targets" }` — both constructs already skip wholesale
            // before descending into their body (see the `optionChoice` /
            // `forEach` cases above), so this arm is never reached by the
            // current catalogue; kept for exhaustiveness against a future
            // card composing it bare. Explicit skip — the Op is new (per-Op
            // regime, `.claude/rules/gre-development.md`) and earns its own
            // hand-written interpreter + wire-format test instead of relying
            // on the canned smoke sweep.
            skipBecause(
                req,
                "op-own-tests",
                `Op "setColor" is new — covered by the Op's own interpreter + wire-format tests`
            );
            return;
        case "setCardTypes":
            // `setCardTypes` (issue #2361) REPLACES a permanent's card types
            // (CR 205.1a layer 4). Same rationale as `animate` above: it
            // changes the target's basic "kind" mid-scenario, which the canned
            // generator's target-seeding (one stable kind per slot) does not
            // model — a permanent that stops being an artifact and starts
            // being a creature is re-binned by the SBA pass the check runs
            // after. Explicit skip — the Op is new (per-Op regime,
            // `.claude/rules/gre-development.md`) and earns its own
            // hand-written interpreter + wire-format tests.
            skipBecause(
                req,
                "op-own-tests",
                `Op "setCardTypes" changes a permanent's card types (CR 205.1a) — covered by the Op's own interpreter + wire-format tests`
            );
            return;
        case "loseAllAbilities":
            // `loseAllAbilities` (issue #2361) strips a permanent's abilities
            // indefinitely (CR 613.1f layer 6). The canned generator seeds a
            // VANILLA filler creature at a permanent slot, so the only outcome
            // it could assert is that an already-empty ability set is still
            // empty — a vacuous assertion, which is worse than no assertion.
            // Explicit skip — the Op is new (per-Op regime) and earns its own
            // hand-written interpreter + wire-format tests, run against a
            // permanent that actually HAS abilities to lose.
            skipBecause(
                req,
                "op-own-tests",
                `Op "loseAllAbilities" strips abilities (CR 613.1f) — the canned filler has none, so it is covered by the Op's own interpreter + wire-format tests`
            );
            return;
        case "loseAllAbilitiesWhileSourceRemains":
            // `loseAllAbilitiesWhileSourceRemains` (issue #1562) strips a
            // permanent's abilities for as long as the resolving source
            // remains (CR 613.1f layer 6). Same rationale as
            // `loseAllAbilities` immediately above (the canned filler has no
            // abilities to lose), PLUS its `target` is an ANNOUNCED SLOT that
            // must resolve to an "ability" stack object (CR 113.7a — the
            // counter-then-rider template), a shape the canned generator's
            // permanent-slot seeding does not produce either. Explicit skip —
            // the Op is new (per-Op regime) and earns its own hand-written
            // interpreter + wire-format tests, run against a permanent that
            // actually has abilities to lose.
            skipBecause(
                req,
                "op-own-tests",
                `Op "loseAllAbilitiesWhileSourceRemains" strips abilities (CR 613.1f) for a source-tied duration — covered by the Op's own interpreter + wire-format tests`
            );
            return;
        case "setSubtype":
            // `setSubtype` (issue #1083) replaces a target land's subtypes
            // for a duration (CR 305.7 layer 4). Same rationale as
            // `setColor` immediately above — every shipped caller (Dream
            // Thrush) composes it inside a suspending `optionChoice`, which
            // already skips before descending. Explicit skip — the Op is new
            // and earns its own hand-written interpreter + wire-format test.
            skipBecause(
                req,
                "op-own-tests",
                `Op "setSubtype" is new — covered by the Op's own interpreter + wire-format tests`
            );
            return;
        case "forEach":
            // The forEach construct (issue #807) iterates a runtime-selected
            // set; the generator cannot predict per-member outcomes (and a
            // body `choice` would suspend for live input). Explicit skip —
            // forEach cards keep their own full per-card tests.
            skipBecause(
                req,
                "source-or-each-subject",
                `construct "forEach" iterates a runtime-selected set — covered by the card's own tests`
            );
            return;
        case "delayedTrigger":
            // CR 603.7 (ADR 0048) — the Op schedules a FUTURE trigger whose
            // body fires at a phase boundary the canned scenario never
            // reaches; the only same-resolution outcome is the queued
            // instance. Explicit skip — scheduling, payload capture and
            // fire-time body execution are covered by the Op's own
            // interpreter tests (per-Op regime, issue #838).
            skipBecause(
                req,
                "later-outcome",
                `Op "delayedTrigger" fires at a future phase boundary — covered by the Op's interpreter tests`
            );
            return;
        case "reflexiveTrigger":
            // CR 603.12 — the Op's only same-resolution outcome is a QUEUED
            // trigger; the body's effects land only after the reflexive
            // ability is placed on the stack, its targets are announced
            // (CR 603.3d) and both players pass priority — none of which a
            // canned single-resolution scenario reaches. Explicit skip:
            // queueing, capture round-trip and body execution are covered by
            // the Op's own interpreter tests (per-Op regime).
            skipBecause(
                req,
                "later-outcome",
                `Op "reflexiveTrigger" resolves on a separate stack object after a priority round — covered by the Op's interpreter tests`
            );
            return;
        case "libraryLook":
            // CR 701.24 (issue #844) — a shuffle is a seeded-PRNG
            // RANDOMIZATION with no deterministic same-resolution outcome the
            // canned generator can assert (the multiset is preserved but the
            // order is unwitnessed, and knowledge-clearing is not projected).
            // Explicit skip — the shuffle primitive is covered by the Op's own
            // interpreter tests (per-Op regime).
            skipBecause(
                req,
                "randomness",
                `Op "libraryLook" shuffles a library (seeded-PRNG randomization) — covered by the Op's interpreter tests`
            );
            return;
        case "shuffleSelfIntoLibrary":
            // CR 608.2 / 701.24 (issue #898) — redirects the RESOLVING
            // spell's own destination from graveyard to a shuffled library.
            // Same rationale as `libraryLook`: a shuffle is a seeded-PRNG
            // randomization with no deterministic same-resolution outcome the
            // canned generator can assert (which library slot the card lands
            // in is unwitnessed). Explicit skip — covered by the Op's own
            // interpreter tests (per-Op regime).
            skipBecause(
                req,
                "randomness",
                `Op "shuffleSelfIntoLibrary" shuffles the resolving spell into a library (seeded-PRNG randomization) — covered by the Op's interpreter tests`
            );
            return;
        case "redirectDamage":
            // CR 614.9 (issue #3810) — a redirection shield sits DORMANT until
            // a later damage event tests it, exactly as `preventDamage`'s
            // shields do: the canned scenario only resolves the spell and
            // never subsequently deals damage, so the shield has no
            // same-resolution outcome the generator can assert. Explicit skip;
            // registration, the points-budget split and CR 614.9's dead
            // destination are covered by the Op's own interpreter tests
            // (per-Op regime).
            skipBecause(
                req,
                "dormant-shield",
                `Op "redirectDamage" registers a dormant shield (no same-resolution damage event) — covered by the Op's interpreter tests`
            );
            return;
        case "preventDamage":
            // CR 615 (issue #845) — a prevention shield sits DORMANT until a
            // later damage event tests it; the canned scenario only resolves
            // the spell (it never subsequently deals damage), so the shield's
            // effect has no same-resolution outcome the generator can assert.
            // Explicit skip — shield registration and consumption are covered
            // by the Op's own interpreter tests (per-Op regime).
            skipBecause(
                req,
                "dormant-shield",
                `Op "preventDamage" registers a dormant shield (no same-resolution damage event) — covered by the Op's interpreter tests`
            );
            return;
        case "regenerate":
            // CR 701.19a (issue #846) — a regeneration shield is a replacement
            // effect that sits DORMANT until a later destroy event consumes it;
            // the canned scenario never destroys anything afterwards, so the
            // shield's CONSUMPTION is the Op's own interpreter tests (per-Op
            // regime). Its REGISTRATION is observable in the same resolution —
            // the shield count on the permanent rises by one — so the generator
            // asserts that on an announced permanent slot or on an ability's
            // own source (issue #3831: "Regenerate this creature"). A `$each`
            // target is not modelled.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "regenerate" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "preventRegeneration":
            // `preventRegeneration` (CR 701.19c, issue #1283) sets an IMMEDIATE
            // `cantBeRegeneratedThisTurn` flag on the target creature,
            // observable in the same resolution. The generator can assert it on an announced
            // permanent slot (it seeds a filler creature there and reads the
            // flag after resolution). A `$each` (or spell-site `$source`) target is not
            // modelled — skip and let the card's own per-card test cover it.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "preventRegeneration" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "exileOnDeath":
            // `exileOnDeath` (CR 614.1a, issue #1095) sets an IMMEDIATE
            // `exileOnDeath` flag on the target creature — like
            // `preventRegeneration` right above, the outcome is observable in
            // the same resolution, so the generator asserts it on an announced
            // permanent slot or on an ability's own source. A `$each` (or spell-site `$source`) target is not modelled — skip and let
            // the card's own per-card test cover it.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "exileOnDeath" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "lockDamage":
            // `lockDamage` (CR 615.12 / 614.9, issue #2231) sets an IMMEDIATE
            // `damageLockThisTurn` flag on the target creature — the same shape
            // as `exileOnDeath` right above, observable in the same resolution.
            // A `$each` (or spell-site `$source`) target is not modelled — skip and let the
            // card's own per-card test cover it.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "lockDamage" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "suppressDamagePrevention":
            // `suppressDamagePrevention` (CR 615.12, issue #3303) — the
            // GAME-scoped sibling of `lockDamage` right above. It has no fields
            // at all, so there is nothing to seed and no slot to record: it
            // sets `state.damageUnpreventableThisTurn` in the SAME resolution,
            // which its `OP_ASSERTORS` entry reads straight off the post-state.
            // No skip is owed — unlike `becomeMonarch` / `winGame`, this global
            // flag needs no seeded board to be observable.
            return;
        case "markAssignsNoCombatDamage":
            // `markAssignsNoCombatDamage` (CR 510.1c, issue #1283) pushes a
            // combat-only, id-scoped entry onto the IMMEDIATE
            // `state.sourcePreventionShields` list (observable in the same
            // resolution). The generator asserts it
            // on an announced permanent slot (seeds a filler creature there and
            // reads the array after resolution). A `$each` (or spell-site `$source`) target is
            // not modelled — skip and let the card's own per-card test cover it.
            if (!subjectModelled(req, op.target)) {
                skipBecause(
                    req,
                    "source-or-each-subject",
                    `Op "markAssignsNoCombatDamage" targets $source/$each — covered by the card's own per-card test`
                );
                return;
            }
            recordSubject(req, op.target);
            return;
        case "transform":
            // CR 701.27 / 712 (issue #1210) — flips a permanent between its
            // front/back printed characteristic sets. The canned generator's
            // assertion vocabulary is numeric (damage/life/counts); a
            // characteristic swap (name/types/P-T/abilities all changing at
            // once, off a `backFace` spec the generator has no notion of) has
            // no same-resolution outcome it can assert generically. Explicit
            // skip — covered by the Op's own interpreter tests (per-Op
            // regime).
            skipBecause(
                req,
                "op-own-tests",
                `Op "transform" swaps a permanent's printed characteristic set (front/back) — covered by the Op's interpreter tests`
            );
            return;
        case "exileAndReturnTransformed":
            // CR 712 / 400.7 / 306.5b (issue #2380) — exiles a permanent and
            // returns it showing its back face. Same reason as `transform`
            // above (a characteristic swap the numeric assertion vocabulary
            // cannot express), plus one more: the canned generator seeds a
            // plain permanent with no `backFace`, so the scripted flip would
            // have nothing to flip INTO and the run would assert nothing.
            // Explicit skip — covered by the Op's own interpreter tests
            // (per-Op regime).
            skipBecause(
                req,
                "op-own-tests",
                `Op "exileAndReturnTransformed" swaps a permanent's printed characteristic set across a CR 400.7 zone change — covered by the Op's interpreter tests`
            );
            return;
        case "createToken":
            // createToken (issue #847) creates token permanents on the
            // controller's battlefield — a deterministic same-resolution
            // outcome the generator asserts directly (it seeds no tokens, so
            // the post-run token count IS the created count). A ref/count
            // `count` (runtime value) or a targeted / ref controller is not
            // modelled — skip and let the card's own per-card test cover it.
            if (op.count !== undefined && typeof op.count !== "number") {
                skipBecause(
                    req,
                    "runtime-amount",
                    `Op "createToken" uses a ref/count token count the canned generator does not model — covered by the card's own per-card test`
                );
                return;
            }
            if (
                op.controller !== "controller" &&
                op.controller !== "opponent"
            ) {
                skipBecause(
                    req,
                    "runtime-amount",
                    `Op "createToken" controller is a targeted/ref player the canned generator does not model — covered by the card's own per-card test`
                );
                return;
            }
            return;
        case "createTokenCopy":
            // CR 707.2 + CR 111.1 (issue #1459) — creates token COPIES of a
            // RUNTIME source permanent (an announced target slot or a `ref` to
            // a permanent bound earlier in the same script). The canned
            // generator seeds neither an announced-target source nor a bound
            // copyable permanent, so it cannot set up a determinate source to
            // assert the resulting copy's copiable characteristics against.
            // Explicit skip — covered by the Op's own interpreter + wire-format
            // tests (both source shapes + count; per-Op regime,
            // `.claude/rules/gre-development.md`).
            skipBecause(
                req,
                "op-own-tests",
                `Op "createTokenCopy" copies a runtime source permanent (announced target / ref) the canned generator does not model — covered by the Op's interpreter tests`
            );
            return;
        case "becomeCopy":
            // CR 707.2 / 611.2a (issue #3236) — an existing permanent becomes a
            // copy of ANOTHER runtime permanent. The generator seeds the same
            // filler creature into every permanent slot, so a copy of one onto
            // the other changes no observable characteristic, and a timed copy
            // reverts only at a phase boundary the canned run never reaches.
            // Explicit skip — covered by the Op's own interpreter + wire-format
            // tests (per-Op regime, `.claude/rules/gre-development.md`).
            skipBecause(
                req,
                "op-own-tests",
                `Op "becomeCopy" copies one runtime permanent onto another (identical canned fillers, phase-boundary revert) — covered by the Op's interpreter tests`
            );
            return;
        case "emblem":
            // CR 114 (issue #1221) — creating an emblem appends one command-zone
            // object owned by the resolved controller, a deterministic
            // same-resolution outcome (the canned scenario seeds no emblems).
            // A targeted / ref owner is not modelled — skip and let the card's
            // own per-card test cover it.
            if (
                op.controller !== undefined &&
                op.controller !== "controller" &&
                op.controller !== "opponent"
            ) {
                skipBecause(
                    req,
                    "runtime-amount",
                    `Op "emblem" controller is a targeted/ref player the canned generator does not model — covered by the card's own per-card test`
                );
                return;
            }
            return;
        case "becomeMonarch":
            // CR 720.2 (issue #1199) — crowning the monarch is a GLOBAL
            // designation (`GameState.monarchId`), not a per-permanent /
            // per-player-resource outcome the canned generator's assertion
            // vocabulary models (battlefield/graveyard/life/counter deltas).
            // Explicit skip — covered by the Op's own interpreter tests
            // (per-Op regime).
            skipBecause(
                req,
                "op-own-tests",
                `Op "becomeMonarch" sets the global monarch designation — covered by the Op's interpreter tests`
            );
            return;
        case "gainControl":
            // CR 613.1b (issue #848) — a control change flips a permanent to a
            // new controller and (for a "for as long as" duration) installs a
            // conditional-control SBA. The canned generator seeds no permanent
            // under another player to steal, and the conditional durations only
            // hold while the SOURCE is tapped / controlled — state the generator
            // does not construct — so there is no same-resolution outcome it can
            // faithfully assert. Explicit skip — the control change and its
            // conditional revert are covered by the Op's own interpreter tests
            // (per-Op regime).
            skipBecause(
                req,
                "op-own-tests",
                `Op "gainControl" changes control of a permanent (and installs a conditional-control SBA) — covered by the Op's interpreter tests`
            );
            return;
        case "optionChoice":
            // CR 700.2 / 601.2b (issue #849) — a modal "choose one" enqueues an
            // `option-pick` Pending Choice and SUSPENDS; which mode runs (and so
            // what outcome to assert) depends on a LIVE player pick the canned
            // generator cannot make. Explicit skip — the mode selection and each
            // branch's execution are covered by the Op's own interpreter tests
            // (per-Op regime). (Mirrors the `choice` / `mayPay` suspending-Op
            // skip.)
            skipBecause(
                req,
                "suspends-for-input",
                `Op "optionChoice" suspends on a live mode pick (CR 700.2) — covered by the Op's interpreter tests`
            );
            return;
        case "coinFlip":
            // CR 705 (issue #851) — a coin flip draws a RANDOM bit from the
            // seeded PRNG and PAUSES for the reveal; which branch runs (and so
            // what outcome to assert) is non-deterministic across seeds and
            // suspends for the reveal ack the canned generator cannot make.
            // Explicit skip — the flip, both branches, and the no-re-roll
            // resume are covered by the Op's own interpreter tests (per-Op
            // regime; mirrors the seeded-PRNG `libraryLook` skip and the
            // suspending `optionChoice` skip).
            skipBecause(
                req,
                "suspends-for-input",
                `Op "coinFlip" draws a random bit and suspends for the reveal (CR 705) — covered by the Op's interpreter tests`
            );
            return;
        case "coinFlipSync":
            // CR 705 (issue #1281) — a synchronous coin flip draws a RANDOM
            // bit from the seeded PRNG; unlike `coinFlip` it never suspends,
            // but the outcome is still non-deterministic across seeds — a
            // canned generator run has no fixed seed to assert a specific
            // branch against. Explicit skip — the flip and both branches are
            // covered by the Op's own interpreter tests (per-Op regime;
            // mirrors the `coinFlip` skip above, minus the suspend reasoning).
            skipBecause(
                req,
                "randomness",
                `Op "coinFlipSync" draws a random bit (CR 705) — covered by the Op's interpreter tests`
            );
            return;
        case "winGame":
            // CR 104.2a (issue #1066) — sets `state.gameOver` directly. The
            // canned generator's post-resolution assertions (board/life
            // deltas) assume the game keeps running; a decided game is a
            // qualitatively different post-state the generator doesn't model.
            // Explicit skip — the Op's own interpreter test (plus Coalition
            // Victory's card-level predicate test) is the behavioural
            // guarantor. Coalition Victory's script is ALSO wrapped in `if`,
            // which already skips unconditionally (see the `"if"` case
            // above), so this arm is defensive/for-completeness.
            skipBecause(
                req,
                "op-own-tests",
                `Op "winGame" sets state.gameOver — covered by the Op's own interpreter test`
            );
            return;
        case "divideIntoPiles":
            // ADR 0053 (pile division, issue #1067) — a TWO-PLAYER divide-
            // then-choose interaction: the divider partitions the object set,
            // then a DIFFERENT player picks a pile, both suspending for a live
            // decision the canned generator cannot make (mirrors the
            // suspending `choice` / `mayPay` / `optionChoice` skips). Explicit
            // skip — each of the six pile cards has its own hand-written
            // interpreter + wire-format test (the Op's per-Op test regime,
            // `.claude/rules/gre-development.md`).
            skipBecause(
                req,
                "card-paired-mechanism",
                `Op "divideIntoPiles" suspends for two DIFFERENT players' picks (ADR 0053) — covered by hand-written per-card tests`
            );
            return;
        case "restrictCombat":
            // CR 508.1a / 509.1b (ADR 0053) — sets a turn-scoped can't-attack/
            // can't-block flag whose only observable effect is at a LATER
            // declare-attackers/declare-blockers step, which the canned
            // single-resolution generator doesn't model (it asserts board/life
            // deltas immediately after resolution, not a later combat step).
            // Explicit skip — covered by the Op's own interpreter test plus
            // Fight or Flight / Stand or Fall's hand-written combat tests.
            skipBecause(
                req,
                "later-outcome",
                `Op "restrictCombat" only manifests at a later combat step — covered by hand-written tests`
            );
            return;
        case "putBack":
            // CR 401.4 (issue #1046) — a suspending `choose-hand-card` pick
            // over the caster's hand whose ORDER the player controls (the
            // pick order becomes the resulting top-of-library order); the
            // canned single-resolution generator cannot drive a live pick.
            // Explicit skip — the suspend/resume, pick-order-preserving
            // top-placement, checkpoint (an earlier Op never re-runs on
            // resume) and wire-format assertions are covered by the Op's own
            // interpreter tests (per-Op regime; mirrors the suspending
            // `choice` / `scryReorder` / `lookDistribute` skips).
            skipBecause(
                req,
                "suspends-for-input",
                `Op "putBack" suspends for a live hand pick (CR 401.4) — covered by the Op's interpreter tests`
            );
            return;
        case "nameCard":
            // CR 201.3 / 202.3 (issue #1085) — a `nameCard` Op suspends
            // resolution for a live open-ended name choice — a canned
            // scenario cannot submit a name, so the script is reported as an
            // explicit skip; execution coverage comes from the Op's own
            // interpreter tests (mirrors the suspending `choice` / `mayPay`
            // skips).
            skipBecause(
                req,
                "suspends-for-input",
                `Op "nameCard" suspends for a live card-name choice (CR 201.4) — covered by the Op's interpreter tests`
            );
            return;
        case "digMatchingToHand":
            // CR 701.20a / 401.4 (issue #1085) — a filter-driven library
            // reveal-and-split. In every shipped card it follows a
            // `nameCard` Op and filters on that Op's chosen-name binding
            // (Desperate Research), which already forces a skip on its own;
            // the generator also has no minimal-filler-library model that
            // guarantees a deterministic filter match/no-match split (mirrors
            // the `mill` skip rationale — "moves top-of-library cards
            // somewhere, not modelable against the generator's filler
            // library"). Explicit skip for exhaustiveness.
            skipBecause(
                req,
                "op-own-tests",
                `Op "digMatchingToHand" depends on a filter match against library contents — covered by the Op's interpreter tests`
            );
            return;
        case "cascade":
            // CR 702.85a (issue #3216) — the cascade keyword's whole triggered
            // ability. It needs a spell ON THE STACK to read its own mana-value
            // threshold from (`ctx.sourceInstanceId`), a stacked library whose
            // top few cards straddle that threshold, AND a live Cast/Decline
            // for the card the walk stops on — none of which the canned
            // single-resolution generator models (it inherits
            // `castDuringResolution`'s own suspension wholesale, since that is
            // literally the Op it runs for the middle clause). Explicit skip;
            // execution coverage is the Op's own interpreter tests (hit / no
            // hit / decline / land skipped / random bottom / empty library).
            skipBecause(
                req,
                "suspends-for-input",
                `Op "cascade" needs its own spell on the stack for the CR 702.85a threshold and suspends for a live Cast/Decline — covered by the Op's interpreter tests`
            );
            return;
        case "castDuringResolution":
            // CR 608.2g (issues #1477 / #1961) — offers the controller a live
            // Cast/Decline (or Play/Decline, for the `includesLand` land
            // branch) of a selected card and, on accept, plays it inline during
            // resolution (a suspending `option-pick`, then the cast card's own
            // suspending target/mode/X picks). The canned single-resolution
            // generator cannot drive those live decisions — nor build the CR 607
            // linked exile the `{ exiledWithSource: true }` selector reads — so
            // the script is an explicit skip; execution coverage comes from the
            // Op's own interpreter tests (cast / play-land / decline /
            // silent-pass) — mirrors the suspending `choice` / `optionChoice` /
            // `nameCard` skips (per-Op regime,
            // `.claude/rules/gre-development.md`).
            skipBecause(
                req,
                "suspends-for-input",
                `Op "castDuringResolution" suspends for a live Cast/Decline + the played card's own picks (CR 608.2g) — covered by the Op's interpreter tests`
            );
            return;
        case "setIslandSanctuaryProtection":
            // CR 508.1c (issue #1283) — a turn-scoped player-wide "can't be
            // attacked except by flying/islandwalk" flag whose only observable
            // effect is at a LATER declare-attackers step, which the canned
            // single-resolution generator doesn't model. Every shipped consumer
            // (Island Sanctuary) additionally wraps this Op in an `optionChoice`
            // mode, which already forces a skip on its own. Explicit skip for
            // exhaustiveness — covered by the Op's own interpreter test plus
            // Island Sanctuary's hand-written combat test.
            skipBecause(
                req,
                "later-outcome",
                `Op "setIslandSanctuaryProtection" only manifests at a later declare-attackers step — covered by hand-written tests`
            );
            return;
        case "setProtectionFromEverything":
            // CR 702.16b/e/i (issue #674) — protection from everything is a
            // GLOBAL player-scoped designation (`GameState.
            // playerProtectionFromEverything`), not a per-permanent /
            // per-player-resource delta the canned generator's assertion
            // vocabulary models (battlefield / graveyard / life / counter).
            // Its observable effects — an untargetable player, prevented
            // damage — only manifest against a LATER spell or damage event.
            // Explicit skip, mirroring `becomeMonarch`; covered by the Op's
            // own interpreter tests plus The One Ring's hand-written tests.
            skipBecause(
                req,
                "op-own-tests",
                `Op "setProtectionFromEverything" sets a global player-scoped protection designation — covered by the Op's interpreter tests`
            );
            return;
        case "rangedTopdeck":
            // CR 119.4 / 121.1 (issue #1283) — a suspending ranged `choose-
            // hand-card` pick over a "drawn this turn" candidate pool the
            // canned single-resolution generator cannot drive a live answer
            // for. Every shipped consumer (Sylvan Library) additionally wraps
            // this Op in an `optionChoice` mode, which already forces a skip
            // on its own. Explicit skip for exhaustiveness — covered by the
            // Op's own interpreter tests (per-Op regime) plus Sylvan
            // Library's hand-written per-card tests.
            skipBecause(
                req,
                "suspends-for-input",
                `Op "rangedTopdeck" suspends for a live ranged hand pick (CR 119.4) — covered by the Op's interpreter tests`
            );
            return;
        case "explore":
            // CR 701.44 (issue #2376) — Explore reveals the top card of the
            // exploring permanent's controller's library and branches on
            // whether it is a LAND. The canned generator seeds only a minimal
            // filler library and cannot provision a KNOWN top card, so which
            // branch runs is unpredictable from here (the same reason
            // `revealTopAndRoute` skips); and the nonland branch additionally
            // SUSPENDS for a live order-top keep-or-bin answer no canned
            // single-resolution scenario can submit (the same reason
            // `scryReorder` skips). Explicit skip; execution coverage is the
            // Op's own interpreter tests, which drive both branches and the
            // empty-library no-op.
            skipBecause(
                req,
                "suspends-for-input",
                `Op "explore" reveals an unprovisionable top card and suspends on the nonland branch's keep-or-bin choice — covered by the Op's interpreter tests`
            );
            return;
        case "chooseCreatureType":
            // CR 205.3m (issue #3721) — SUSPENDS for a live creature-type pick
            // out of a ~280-option list, which a canned single-resolution
            // scenario cannot submit (the same reason `nameCard` skips, and
            // the same reason: the answer is the whole point, and every card
            // that asks for it reads it back through a filter ref). Explicit
            // skip; execution coverage is the Op's own interpreter tests,
            // which drive the suspend, the resume and the unresolvable-chooser
            // no-op.
            skipBecause(
                req,
                "suspends-for-input",
                `Op "chooseCreatureType" suspends for a live creature-type choice (CR 205.3m) — covered by the Op's interpreter tests`
            );
            return;
        default: {
            // Exhaustiveness guard: a registered Op with no analyser branch is
            // a skip, not a silent pass.
            const _never: never = op;
            void _never;
            skipBecause(
                req,
                "unanalysed",
                `no scenario analyser for Op "${(op as EffectOp).op}"`
            );
        }
    }
}

// --- Scenario construction --------------------------------------------------

/** Builds the canned GameState + announced targets satisfying `req`, or the
 *  skips that say why a requirement cannot be met. */
function buildScenario(req: Requirements): Scenario | { skip: SmokeSkip[] } {
    if (req.skips.length > 0) return { skip: req.skips };

    // A permanent target lives on the OPPONENT's battlefield (so destroy/exile
    // outcomes are observable on p2 and never hit the caster's own board).
    const targetPermanentIds: Record<number, string> = {};
    const oppBattlefield: CardInstanceState[] = [];
    const targets: TargetSelection[] = [];
    let sawPlayerSlot = false;
    let sawPermanentSlot = false;

    // Target slots must be contiguous from 0 for the announce order to line up
    // (CR 601.2c). The generator only ever produces a single-slot script in the
    // catalogue today, but handle multiple defensively.
    const maxSlot = Math.max(-1, ...req.targetSlots.keys());
    for (let slot = 0; slot <= maxSlot; slot++) {
        const kind = req.targetSlots.get(slot);
        if (!kind) {
            return {
                skip: [
                    {
                        code: "target-slot-shape",
                        reason: `target slots are not contiguous (missing ${slot})`,
                    },
                ],
            };
        }
        if (kind === "player") {
            sawPlayerSlot = true;
            targets[slot] = { type: "player", id: OPPONENT_ID };
        } else {
            sawPermanentSlot = true;
            const permId = `gen-tgt-${slot}`;
            targetPermanentIds[slot] = permId;
            oppBattlefield.push(
                makeInstance(FILLER_CARD_ID, {
                    id: permId,
                    controllerId: OPPONENT_ID,
                    ownerId: OPPONENT_ID,
                    zone: "battlefield",
                })
            );
            targets[slot] = { type: "permanent", id: permId };
        }
    }
    if (sawPlayerSlot && sawPermanentSlot) {
        return {
            skip: [
                {
                    code: "target-slot-shape",
                    reason: "script mixes player and permanent target slots",
                },
            ],
        };
    }

    // Libraries for drawing players.
    const p1Library = req.drawingPlayers.has(CASTER_ID)
        ? spawnFiller(CASTER_ID, "library", LIBRARY_DEPTH, "gen-lib")
        : [];
    const p2Library = req.drawingPlayers.has(OPPONENT_ID)
        ? spawnFiller(OPPONENT_ID, "library", LIBRARY_DEPTH, "gen-lib")
        : [];

    // Count sets: populate the requested zone for the requested controller so
    // the count is a fixed, known size (COUNT_SET_SIZE).
    const p1Bf = [
        ...oppBattlefield.filter((c) => c.controllerId === CASTER_ID),
    ];
    const p2Bf = [
        ...oppBattlefield.filter((c) => c.controllerId === OPPONENT_ID),
    ];
    const p1Gy: CardInstanceState[] = [];
    const p2Gy: CardInstanceState[] = [];
    for (const spec of req.countSets) {
        const owner =
            spec.controller === "controller" ? CASTER_ID : OPPONENT_ID;
        // Seed cards whose DEFINITION satisfies the filter, so the count is a
        // known non-zero size (an unfiltered set counts the generic filler).
        const fillerId = spec.filter
            ? countFillerId(spec.filter)
            : FILLER_CARD_ID;
        const bank = spawnMatching(
            fillerId,
            owner,
            spec.zone,
            COUNT_SET_SIZE,
            `gen-cnt-${spec.zone}`
        );
        // Bank the filler in the zone the spec actually names. The `else` that
        // used to catch everything-but-battlefield pushed a `zone: "library"`
        // spec's bank into the GRAVEYARD (issue #783 review), so the predicted
        // count could never match the real one. `analyseValue` now
        // skip-with-reasons a library count set outright, but the branch is
        // explicit here too so this filler can never again seed the wrong zone.
        if (spec.zone === "battlefield") {
            (owner === CASTER_ID ? p1Bf : p2Bf).push(...bank);
        } else if (spec.zone === "graveyard") {
            (owner === CASTER_ID ? p1Gy : p2Gy).push(...bank);
        } else {
            (owner === CASTER_ID ? p1Library : p2Library).push(...bank);
        }
    }

    // CR 113.7 — the source of an activated or triggered ability is the object
    // whose ability it is: a permanent the caster controls, untapped and past
    // summoning sickness (its cost is not what the smoke run proves). Tapped
    // when an Op untaps it, so the untap has an outcome to observe.
    //
    // It is hydrated from the HOST card's own kind (issue #3879), not from the
    // generic filler creature: an Op whose primitive reads what the permanent
    // IS — `setExileOnDeath` and `setDamageLockThisTurn` refuse a permanent
    // whose type line has no Creature (CR 205.1), `setLevel` writes a class
    // level bar (CR 716.2a) — is then
    // proven against the permanent the card actually has. A host whose kind the
    // Op refuses outright never reaches here: `recordSubject` skipped it.
    //
    // It is pushed AFTER the count-set banks, and that ordering is now
    // invisible: `predictAmount` adds the source to a count set it really
    // contributes to (`sourceContributesTo` below), instead of predicting the
    // bank size and reading one more.
    let sourcePermanentId: string | undefined;
    const source = seedableSource(req);
    if (req.sourceSubject && source !== undefined) {
        for (const spec of req.countSets) {
            if (sourceContributesTo(source, spec) !== "undecidable") continue;
            return {
                skip: [
                    {
                        code: "runtime-amount",
                        reason: `count set filters on a characteristic the seeded $source does not model — the predicted count would be a guess`,
                    },
                ],
            };
        }
        sourcePermanentId = SOURCE_PERMANENT_ID;
        p1Bf.push(
            makeInstance(sourceCardId(source), {
                id: SOURCE_PERMANENT_ID,
                controllerId: CASTER_ID,
                ownerId: CASTER_ID,
                zone: "battlefield",
                isSummoningSick: false,
                isTapped: req.sourceTapAction === "untap",
            })
        );
    }

    const state = makeState({
        players: [
            makePlayer(CASTER_ID, {
                library: p1Library,
                battlefield: p1Bf,
                graveyard: p1Gy,
            }),
            makePlayer(OPPONENT_ID, {
                library: p2Library,
                battlefield: p2Bf,
                graveyard: p2Gy,
            }),
        ],
    });

    return {
        state,
        targets,
        targetPermanentIds,
        ...(sourcePermanentId === undefined
            ? {}
            : { sourcePermanentId, sourceSpec: source }),
        targetKind: sawPlayerSlot
            ? "player"
            : sawPermanentSlot
              ? "permanent"
              : "none",
    };
}

// --- Assertion derivation (per Op kind) -------------------------------------

/** An assertor takes an Op, the built scenario, and the PRE-resolution state
 *  (to capture baseline totals) and returns a post-resolution check. Keyed by
 *  Op name; the coverage guard test keeps this 1:1 with `EFFECT_OP_REGISTRY`. */
type Assertor = (
    op: EffectOp,
    scenario: Scenario,
    pre: GameState
) => Assertion | null;

/**
 * Whether the seeded SOURCE permanent is itself counted by `spec` (issue
 * #3879). It sits on the CASTER's battlefield, so a count of any other zone or
 * of the other player's side never sees it; when it does, the count the script
 * reads is the bank PLUS the source.
 *
 * `"undecidable"` when the filter reads a characteristic the seeded source's
 * definition does not model (a supertype, a colour, a mana value): predicting
 * either way would be a guess, so `buildScenario` skips the script instead.
 */
function sourceContributesTo(
    source: SmokeSourceSpec,
    spec: EffectCountSpec
): boolean | "undecidable" {
    if (spec.zone !== "battlefield") return false;
    if (spec.controller !== "controller") return false;
    const filter = spec.filter;
    if (filter === undefined) return true;
    const { type, subtype, ...rest } = filter;
    if (Object.keys(rest).length > 0) return "undecidable";
    // issue #3721 — a `{ ref }` subtype names a `chooseCreatureType` binding
    // whose value only exists mid-resolution, so this static reader cannot
    // decide it. "undecidable" is the honest answer; treating it as "no
    // subtype constraint" would be the fail-OPEN this helper's own array
    // handling below is careful to avoid.
    if (
        subtype !== undefined &&
        !Array.isArray(subtype) &&
        typeof subtype !== "string"
    ) {
        return "undecidable";
    }
    // issue #677 — `type` / `subtype` may be an OR-array, so ONE matching
    // member is a match.
    const types = type === undefined ? [] : [type].flat();
    if (types.length > 0 && !types.some((t) => source.types.includes(t)))
        return false;
    const subtypes = subtype === undefined ? [] : [subtype].flat();
    const own = source.subtypes ?? [];
    if (subtypes.length > 0 && !subtypes.some((s) => own.includes(s)))
        return false;
    return true;
}

/** Reads the size of a count set in the scenario: COUNT_SET_SIZE per
 *  contributing spec (the generator seeds exactly that many), plus the seeded
 *  `$source` permanent when the spec really counts it (issue #3879). */
function predictAmount(value: EffectValue, scenario: Scenario): number | null {
    if (typeof value === "number") return value;
    if ("ref" in value) return null; // skipped earlier — defensive
    if ("counters" in value) return null; // skipped earlier — defensive
    if ("domain" in value) return null; // skipped earlier — defensive
    if ("devotion" in value) return null; // skipped earlier — defensive
    if ("lifeGainedThisTurn" in value) return null; // skipped earlier
    if ("cardsDrawnThisTurn" in value) return null; // skipped earlier
    if ("playerCounters" in value) return null; // skipped earlier — defensive
    if ("difference" in value) return null; // skipped earlier — defensive
    if ("scaled" in value) return null; // skipped earlier — defensive
    if ("divide" in value) return null; // skipped earlier — defensive
    if (!("count" in value)) return null; // skipped earlier — defensive
    const source = scenario.sourceSpec;
    if (source === undefined) return COUNT_SET_SIZE;
    // "undecidable" never reaches here — `buildScenario` skipped the script.
    return (
        COUNT_SET_SIZE +
        (sourceContributesTo(source, value.count) === true ? 1 : 0)
    );
}

const OP_ASSERTORS: Record<string, Assertor> = {
    // Damage to a player is an observable life delta; damage to a permanent is
    // marked damage (CR 120.3). The filler creature (toughness 5) survives.
    dealDamage(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "dealDamage" }>;
        const amount = predictAmount(op.amount, scenario);
        if (amount === null) return null;
        if ("player" in op.to) {
            const pid = assertionPlayerId(op.to.player);
            const before = findPlayer(pre, pid).life;
            const expected = before - amount;
            return {
                label: `dealDamage ${amount} to player ${pid} (life ${before}→${expected})`,
                check: (post) => {
                    const life = findPlayer(post, pid).life;
                    return {
                        ok: life === expected,
                        detail: `life ${life}, expected ${expected}`,
                    };
                },
            };
        }
        // `{ ref: "$each" }` recipients never reach the assertor (their
        // script is skipped in analysis) — defensive.
        if (!("target" in op.to)) return null;
        const permId = scenario.targetPermanentIds[op.to.target];
        return {
            label: `dealDamage ${amount} marks target permanent ${permId}`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                return {
                    ok: (perm.damageMarked ?? 0) === amount,
                    detail: `marked ${perm.damageMarked ?? 0}, expected ${amount}`,
                };
            },
        };
    },
    // Draw grows the recipient's hand by the drawn count (CR 121.1).
    draw(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "draw" }>;
        const count = predictAmount(op.count, scenario);
        if (count === null) return null;
        const pid = assertionPlayerId(op.player);
        const before = findPlayer(pre, pid).hand.length;
        const expected = before + count;
        return {
            label: `draw ${count} for player ${pid} (hand ${before}→${expected})`,
            check: (post) => {
                const size = findPlayer(post, pid).hand.length;
                return {
                    ok: size === expected,
                    detail: `hand ${size}, expected ${expected}`,
                };
            },
        };
    },
    gainLife(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "gainLife" }>;
        const amount = predictAmount(op.amount, scenario);
        if (amount === null) return null;
        const pid = assertionPlayerId(op.player);
        const before = findPlayer(pre, pid).life;
        const expected = before + amount;
        return {
            label: `gainLife ${amount} for player ${pid} (life ${before}→${expected})`,
            check: (post) => {
                const life = findPlayer(post, pid).life;
                return {
                    ok: life === expected,
                    detail: `life ${life}, expected ${expected}`,
                };
            },
        };
    },
    // CR 122.1 — counters on a PLAYER. Reads the kind's dedicated scalar
    // through `PLAYER_COUNTER_FIELD`, so a new kind is asserted without a new
    // assertor (issue #1969).
    addPlayerCounter(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "addPlayerCounter" }>;
        const amount = predictAmount(op.amount, scenario);
        if (amount === null) return null;
        const pid = assertionPlayerId(op.player);
        const before = readPlayerCounters(findPlayer(pre, pid), op.counter);
        const expected = before + amount;
        return {
            label: `addPlayerCounter ${amount} ${op.counter} for player ${pid} (${before}→${expected})`,
            check: (post) => {
                const have = readPlayerCounters(
                    findPlayer(post, pid),
                    op.counter
                );
                return {
                    ok: have === expected,
                    detail: `${op.counter} ${have}, expected ${expected}`,
                };
            },
        };
    },
    loseLife(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "loseLife" }>;
        const amount = predictAmount(op.amount, scenario);
        if (amount === null) return null;
        const pid = assertionPlayerId(op.player);
        const before = findPlayer(pre, pid).life;
        const expected = before - amount;
        return {
            label: `loseLife ${amount} for player ${pid} (life ${before}→${expected})`,
            check: (post) => {
                const life = findPlayer(post, pid).life;
                return {
                    ok: life === expected,
                    detail: `life ${life}, expected ${expected}`,
                };
            },
        };
    },
    // `restrictCasting` (CR 601.3a, issue #1057) — a deterministic
    // same-resolution state change: the named player's id lands in
    // state.cannotCastSpellsThisTurn (the turn-scoped cast lock the shared cast
    // gate reads). Asserted directly.
    restrictCasting(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "restrictCasting" }>;
        const pid = assertionPlayerId(op.player);
        const wasLocked =
            pre.cannotCastSpellsThisTurn?.some((e) => e.playerId === pid) ??
            false;
        return {
            label: `restrictCasting locks player ${pid} out of casting this turn`,
            check: (post) => {
                const locked =
                    post.cannotCastSpellsThisTurn?.some(
                        (e) => e.playerId === pid
                    ) ?? false;
                return {
                    ok: locked && !wasLocked,
                    detail: `locked=${locked} (was ${wasLocked})`,
                };
            },
        };
    },
    // `grantCastTiming` (CR 601.3b, Teferi +1) — a deterministic same-resolution
    // state change: the named player's id lands in state.castTimingFlashGrants
    // (the per-player "cast as though flash" grant the shared cast gate reads).
    grantCastTiming(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "grantCastTiming" }>;
        const pid = assertionPlayerId(op.player);
        const wasGranted =
            pre.castTimingFlashGrants?.some((e) => e.playerId === pid) ?? false;
        return {
            label: `grantCastTiming grants player ${pid} flash-timing this turn`,
            check: (post) => {
                const granted =
                    post.castTimingFlashGrants?.some(
                        (e) => e.playerId === pid
                    ) ?? false;
                return {
                    ok: granted && !wasGranted,
                    detail: `granted=${granted} (was ${wasGranted})`,
                };
            },
        };
    },
    // `reduceSpellCostThisTurn` (CR 601.2f / 514.2, issue #3340, Urza +2) — a
    // deterministic same-resolution state change: one more floating reduction
    // entry for the named player lands in state.spellCostReductionsThisTurn.
    // Counted rather than merely tested for presence, because the Op is
    // ADDITIVE (601.2f "minus all cost reductions") — a second resolution must
    // push a second entry, not be swallowed as a duplicate.
    reduceSpellCostThisTurn(rawOp, _scenario, pre) {
        const op = rawOp as Extract<
            EffectOp,
            { op: "reduceSpellCostThisTurn" }
        >;
        const pid = assertionPlayerId(op.player);
        const before =
            pre.spellCostReductionsThisTurn?.filter((e) => e.playerId === pid)
                .length ?? 0;
        return {
            label: `reduceSpellCostThisTurn installs a floating cost reduction for player ${pid} this turn`,
            check: (post) => {
                const after =
                    post.spellCostReductionsThisTurn?.filter(
                        (e) => e.playerId === pid
                    ).length ?? 0;
                return {
                    ok: after === before + 1,
                    detail: `entries=${after} (was ${before})`,
                };
            },
        };
    },
    // `grantSpellManaSubstitution` (CR 609.4b / 118.14, issue #2890, North
    // Star) — a deterministic same-resolution state change: a grant of the
    // named breadth lands under the named player's key in
    // state.spellManaSubstitutionGrants.
    grantSpellManaSubstitution(rawOp, _scenario, pre) {
        const op = rawOp as Extract<
            EffectOp,
            { op: "grantSpellManaSubstitution" }
        >;
        const pid = assertionPlayerId(op.player);
        const before = pre.spellManaSubstitutionGrants?.[pid]?.length ?? 0;
        return {
            label: `grantSpellManaSubstitution grants player ${pid} one ${op.breadth} spell this turn`,
            check: (post) => {
                const after =
                    post.spellManaSubstitutionGrants?.[pid]?.length ?? 0;
                const holds =
                    post.spellManaSubstitutionGrants?.[pid]?.includes(
                        op.breadth
                    ) ?? false;
                return {
                    ok: after === before + 1 && holds,
                    detail: `grants=${after} (was ${before}), holds ${op.breadth}=${holds}`,
                };
            },
        };
    },
    // `grantManaSubstitution` (CR 609.4b, issue #3811, False Dawn) — a
    // deterministic same-resolution state change: a `{ from, breadth }` entry
    // lands under the named player's key in state.manaSubstitutionGrantsThisTurn.
    grantManaSubstitution(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "grantManaSubstitution" }>;
        const pid = assertionPlayerId(op.player);
        const before = pre.manaSubstitutionGrantsThisTurn?.[pid]?.length ?? 0;
        return {
            label: `grantManaSubstitution lets player ${pid} spend ${op.from} as ${op.breadth} this turn`,
            check: (post) => {
                const grants = post.manaSubstitutionGrantsThisTurn?.[pid] ?? [];
                const holds = grants.some(
                    (g) => g.from === op.from && g.breadth === op.breadth
                );
                return {
                    ok: grants.length === before + 1 && holds,
                    detail: `grants=${grants.length} (was ${before}), holds ${op.from}/${op.breadth}=${holds}`,
                };
            },
        };
    },
    // `replaceManaProductionColor` (CR 614.1a, issue #3811, False Dawn) — a
    // deterministic same-resolution state change: the colour lands under the
    // named player's key in state.manaProductionColorThisTurn.
    replaceManaProductionColor(rawOp) {
        const op = rawOp as Extract<
            EffectOp,
            { op: "replaceManaProductionColor" }
        >;
        const pid = assertionPlayerId(op.player);
        return {
            label: `replaceManaProductionColor makes player ${pid}'s coloured mana ${op.color} this turn`,
            check: (post) => {
                const color = post.manaProductionColorThisTurn?.[pid];
                return { ok: color === op.color, detail: `color=${color}` };
            },
        };
    },
    // `restrictActivation` (CR 602.1 / 605.1a, issue #1124) — a deterministic
    // same-resolution state change: the named player's id lands in
    // state.cannotActivateAbilitiesThisTurn. Asserted directly.
    restrictActivation(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "restrictActivation" }>;
        const pid = assertionPlayerId(op.player);
        const wasLocked =
            pre.cannotActivateAbilitiesThisTurn?.includes(pid) ?? false;
        return {
            label: `restrictActivation locks player ${pid} out of activating abilities this turn`,
            check: (post) => {
                const locked =
                    post.cannotActivateAbilitiesThisTurn?.includes(pid) ??
                    false;
                return {
                    ok: locked && !wasLocked,
                    detail: `locked=${locked} (was ${wasLocked})`,
                };
            },
        };
    },
    // `skipDrawStepThisTurn` (CR 504.1, issue #1097 — Elfhame Sanctuary) — a
    // deterministic same-resolution state change: the named player's id
    // lands in state.skipDrawStepThisTurn. Asserted directly.
    skipDrawStepThisTurn(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "skipDrawStepThisTurn" }>;
        const pid = assertionPlayerId(op.player);
        const wasArmed = pre.skipDrawStepThisTurn?.includes(pid) ?? false;
        return {
            label: `skipDrawStepThisTurn arms player ${pid} to skip their draw step this turn`,
            check: (post) => {
                const armed = post.skipDrawStepThisTurn?.includes(pid) ?? false;
                return {
                    ok: armed && !wasArmed,
                    detail: `armed=${armed} (was ${wasArmed})`,
                };
            },
        };
    },
    // `grantGraveyardPlay` (CR 305.1-analog / 601, issue #1149) — a
    // deterministic same-resolution state change: the named player's id
    // lands in state.graveyardPlayPermissionThisTurn. Asserted directly.
    grantGraveyardPlay(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "grantGraveyardPlay" }>;
        const pid = assertionPlayerId(op.player);
        const wasGranted =
            pre.graveyardPlayPermissionThisTurn?.some(
                (e) => e.playerId === pid
            ) ?? false;
        return {
            label: `grantGraveyardPlay grants player ${pid} a graveyard-cast permission this turn`,
            check: (post) => {
                const granted =
                    post.graveyardPlayPermissionThisTurn?.some(
                        (e) => e.playerId === pid
                    ) ?? false;
                return {
                    ok: granted && !wasGranted,
                    detail: `granted=${granted} (was ${wasGranted})`,
                };
            },
        };
    },
    // `armGraveyardRedirect` (CR 614, issue #1145 / #1149) — a deterministic
    // same-resolution state change: the named player's id lands in
    // state.graveyardBoundRedirectThisTurn. Asserted directly.
    armGraveyardRedirect(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "armGraveyardRedirect" }>;
        const pid = assertionPlayerId(op.player);
        const wasArmed =
            pre.graveyardBoundRedirectThisTurn?.some(
                (e) => e.ownerId === pid
            ) ?? false;
        return {
            label: `armGraveyardRedirect arms player ${pid}'s graveyard-bound redirect this turn`,
            check: (post) => {
                const armed =
                    post.graveyardBoundRedirectThisTurn?.some(
                        (e) => e.ownerId === pid
                    ) ?? false;
                return {
                    ok: armed && !wasArmed,
                    detail: `armed=${armed} (was ${wasArmed})`,
                };
            },
        };
    },
    // addMana (issue #850) adds mana to a player's pool — a deterministic
    // same-resolution delta the generator asserts directly (CR 106.1). It reads
    // the recipient's per-colour pool before/after and checks every produced
    // pip landed.
    addMana(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "addMana" }>;
        const pid = assertionPlayerId(op.player ?? "controller");
        // CR 106.1 / 702.189a (issue #3235) — a plain deposit lands in the
        // fungible `manaPool`; one carrying a `persistsUntil` lifetime lands
        // in the tagged `restrictedMana` list instead (the count map has
        // nowhere to record a lifetime). The assertion reads the bucket the Op
        // actually NAMES rather than summing both (PR #3549 review, nit 10):
        // a both-buckets sum would report a correct deposit and a routing bug
        // — mana in the wrong list — identically, which is precisely the class
        // of defect the smoke sweep exists to catch.
        const balance = (
            player: Pick<PlayerState, "manaPool" | "restrictedMana">,
            color: string
        ): number =>
            op.persistsUntil === undefined
                ? (player.manaPool[color] ?? 0)
                : (player.restrictedMana ?? []).reduce(
                      (total, unit) =>
                          unit.color === color &&
                          unit.persistsUntil === op.persistsUntil
                              ? total + unit.amount
                              : total,
                      0
                  );
        const preP = findPlayer(pre, pid);
        const added = Object.entries(op.mana).filter(([, n]) => (n ?? 0) > 0);
        const before = Object.fromEntries(
            added.map(([color]) => [color, balance(preP, color)])
        );
        return {
            label: `addMana ${added
                .map(([c, n]) => `${n}${c}`)
                .join("")} to player ${pid}`,
            check: (post) => {
                const postP = findPlayer(post, pid);
                for (const [color, amount] of added) {
                    const expected = (before[color] ?? 0) + (amount ?? 0);
                    const actual = balance(postP, color);
                    if (actual !== expected) {
                        const where =
                            op.persistsUntil === undefined
                                ? "pool"
                                : `${op.persistsUntil} bucket`;
                        return {
                            ok: false,
                            detail: `${color} ${where} ${actual}, expected ${expected}`,
                        };
                    }
                }
                return { ok: true };
            },
        };
    },
    // Zone change: destroy moves the target to its owner's graveyard
    // (CR 701.8 destroy — the filler is not indestructible).
    destroy(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "destroy" }>;
        if (!("target" in op.target)) return null; // $each — skipped upstream
        const permId = scenario.targetPermanentIds[op.target.target];
        return {
            label: `destroy moves target permanent ${permId} to graveyard`,
            check: (post) => {
                const onBf = post.players
                    .flatMap((p) => p.battlefield)
                    .some((c) => c.id === permId);
                const inGy = post.players
                    .flatMap((p) => p.graveyard)
                    .some((c) => c.id === permId);
                return {
                    ok: !onBf && inGy,
                    detail: `onBattlefield=${onBf} inGraveyard=${inGy}`,
                };
            },
        };
    },
    // `attach` (CR 701.3a, ADR 0065, issue #1311) — never reached: `analyseOp`
    // skips every script with an attach Op (Reconfigure's "target creature YOU
    // control" requirement is not modelable by the canned generator's
    // opponent-battlefield target placement). Kept for the 1:1 coverage
    // guard; the Op's own interpreter + card tests are the behavioural
    // guarantor.
    attach() {
        return null;
    },
    // `unattach` (CR 701.3d, ADR 0065, issue #1311) — never reached:
    // `analyseOp` skips every script with an unattach Op (its outcome is only
    // observable after a prior attach ran in the same script, which the
    // generator doesn't sequence). Kept for the 1:1 coverage guard; the Op's
    // own interpreter + card tests are the behavioural guarantor.
    unattach() {
        return null;
    },
    // `choice` (issue #805) — never reached: `analyseOp` skips every script
    // containing a choice Op (a canned scenario cannot submit a live player
    // pick). The entry exists so the registry ⇄ assertor coverage guard stays
    // 1:1; execution coverage for choice-carrying cards is their own
    // suspension/resume tests.
    choice() {
        return null;
    },
    // `discard` (issue #805) — never reached, same rationale as `choice`
    // (its `cards` picks binding depends on a live player pick).
    discard() {
        return null;
    },
    // `grantCastFromExile` (issue #1156) — never reached, same rationale as
    // `discard`/`sacrifice` (its `card` picks binding depends on a live
    // player pick from a preceding `choice(zone: "exile")` Op). Kept for the
    // 1:1 coverage guard; execution coverage is the card's own
    // suspension/resume tests + the Op's dedicated interpreter tests.
    grantCastFromExile() {
        return null;
    },
    // `grantCastFromGraveyard` (issue #1344 / #1650) — never reached, same
    // rationale as `grantCastFromExile` (its `card` names either a live
    // choice pick or an announced graveyard target, and its outcome is a
    // cast permission, not an asserted state delta). Kept for the 1:1
    // coverage guard; execution coverage is the card's own tests (Emry,
    // `sets/eld/__tests__/blue.test.ts`) + the Op's interpreter tests.
    grantCastFromGraveyard() {
        return null;
    },
    // `reveal` (issue #920 / #682) — never reached: `analyseOp` skips every
    // script containing it (an information-visibility change, not a state
    // check the canned generator asserts). Kept for the 1:1 coverage guard;
    // execution coverage is the card's own tests.
    reveal() {
        return null;
    },
    // `lookRandomHand` (Urza's Bauble) — never reached: `analyseOp` skips every
    // script containing it (a private-visibility change, not an asserted state
    // check). Kept for the 1:1 coverage guard; coverage is the Op's own tests.
    lookRandomHand() {
        return null;
    },
    // `lookHand` (issue #2383) — never reached: `analyseOp` skips every script
    // containing it (a private-visibility change, not an asserted state check).
    // Kept for the 1:1 coverage guard; coverage is the Op's own tests.
    lookHand() {
        return null;
    },
    // `mayPay` (issue #806) — never reached: `analyseOp` skips every script
    // containing a mayPay Op (a canned scenario cannot answer a live Pay/Skip
    // prompt). The entry keeps the registry ⇄ assertor guard 1:1; execution
    // coverage is the card's own suspension/resume tests.
    mayPay() {
        return null;
    },
    // `payVariableMana` (issue #1701) — never reached: `analyseOp` skips every
    // script containing it (a canned scenario cannot nominate an amount). The
    // entry keeps the registry <-> assertor guard 1:1; execution coverage is
    // the Op's own interpreter tests.
    payVariableMana() {
        return null;
    },
    // `chooseNumber` (issue #1421) — never reached: `analyseOp` skips every
    // script containing it (a canned scenario cannot nominate a number). The
    // entry keeps the registry <-> assertor guard 1:1; execution coverage is
    // the Op's own interpreter tests.
    chooseNumber() {
        return null;
    },
    // `if` (issue #806) — never reached: `analyseOp` skips every script with an
    // `if` construct (the taken branch depends on a runtime predicate). Kept for
    // the 1:1 coverage guard; branch coverage is the card's own tests.
    if() {
        return null;
    },
    // `counter` (issue #806) — never reached: `analyseOp` skips every script
    // with a counter Op (needs a spell on the stack the generator does not
    // seed). Kept for the 1:1 coverage guard; counter coverage is the card's
    // own resolution test.
    counter() {
        return null;
    },
    // `moveSpellFromStack` (issue #2605) — never reached: `analyseOp` skips
    // every script carrying it (needs a spell on the stack the generator does
    // not seed). Kept for the 1:1 coverage guard; execution coverage is the
    // Op's own interpreter tests.
    moveSpellFromStack() {
        return null;
    },
    // `sacrifice` (issue #807) — never reached, same rationale as `discard`
    // (its `permanents` picks binding depends on a live player pick).
    sacrifice() {
        return null;
    },
    // `forEach` (issue #807) — never reached: `analyseOp` skips every script
    // with a forEach construct (per-member outcomes are runtime-selected).
    // Kept for the 1:1 coverage guard; forEach coverage is the card's own
    // tests.
    forEach() {
        return null;
    },
    // `moveZone` (issue #839) — never reached: `analyseOp` skips every script
    // with a moveZone Op (the object's source zone is not modelled by the
    // canned generator). Kept for the 1:1 coverage guard; zone-move coverage
    // is the card's own per-card test.
    moveZone() {
        return null;
    },
    // `pump` (issue #840, CR 613.4c) — a fixed-amount pump on an announced
    // permanent slot is observable as an effective-P/T delta (the temporary
    // buff is active for the rest of the turn, so it reads immediately after
    // resolution). `$each` / spell-site `$source` targets and `ref`/`count` amounts are
    // skipped upstream in `analyseOp` (returns null defensively here).
    pump(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "pump" }>;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        if (typeof op.power !== "number" || typeof op.toughness !== "number") {
            return null;
        }
        const permBefore = pre.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === permId);
        if (!permBefore) return null;
        const beforeP = getEffectivePower(pre, permBefore);
        const beforeT = getEffectiveToughness(pre, permBefore);
        const expP = beforeP + op.power;
        const expT = beforeT + op.toughness;
        return {
            label: `pump ${op.power}/${op.toughness} on permanent ${permId} (P/T ${beforeP}/${beforeT}→${expP}/${expT})`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                const ap = getEffectivePower(post, perm);
                const at = getEffectiveToughness(post, perm);
                return {
                    ok: ap === expP && at === expT,
                    detail: `P/T ${ap}/${at}, expected ${expP}/${expT}`,
                };
            },
        };
    },
    // `counters` (issue #841, CR 122) — a fixed-count ADD on an announced
    // permanent slot is observable as a rise in the counter tally on the card
    // (counters are stored on the instance and persist, so they read
    // immediately after resolution). `remove`, `$each` / spell-site `$source` targets and
    // `ref`/`count` amounts are skipped upstream in `analyseOp` (returns null
    // defensively here).
    // `setLevel` (issue #3234, CR 716.2a) — an announced permanent slot's class
    // level is observable directly on the instance after resolution (CR 716.2d:
    // a permanent the generator seeded has no level, so it reads as 1).
    // `$each` / spell-site `$source` targets are skipped upstream in `analyseOp` (returns
    // null defensively here).
    setLevel(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "setLevel" }>;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        const permBefore = pre.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === permId);
        if (!permBefore) return null;
        // CR 716.2d — a permanent with no level is treated as level 1, so a bar
        // whose level is not above that would be a no-op and nothing to assert.
        if (classLevelOf(permBefore) >= op.level) return null;
        return {
            label: `set permanent ${permId} to class level ${op.level}`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                const actual = classLevelOf(perm);
                return {
                    ok: actual === op.level,
                    detail: `class level ${actual}, expected ${op.level}`,
                };
            },
        };
    },
    counters(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "counters" }>;
        if (op.action !== "add") return null;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        if (typeof op.count !== "number") return null;
        const permBefore = pre.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === permId);
        if (!permBefore) return null;
        const before = permBefore.counters?.[op.counter] ?? 0;
        const expected = before + op.count;
        return {
            label: `add ${op.count} ${op.counter} counter(s) to permanent ${permId} (${before}→${expected})`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                const actual = perm.counters?.[op.counter] ?? 0;
                return {
                    ok: actual === expected,
                    detail: `${op.counter} counters ${actual}, expected ${expected}`,
                };
            },
        };
    },
    // `tapUntap` (issue #842, CR 701.26) — a TAP on an announced permanent slot
    // is observable as `isTapped` flipping false→true on the seeded (untapped)
    // filler permanent. `untap` (the filler starts untapped, nothing to
    // observe) and `$each` / spell-site `$source` targets are skipped upstream in
    // `analyseOp` (returns null defensively here).
    tapUntap(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "tapUntap" }>;
        // An untap is modelled only on `$source`, which `buildScenario` then
        // seeds tapped (issue #3831); a slot untap is skipped upstream.
        if (op.action !== "tap" && !isSourceRef(op.target)) return null;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        const tapped = op.action === "tap";
        return {
            label: `${op.action} permanent ${permId} (isTapped ${!tapped}→${tapped})`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                return {
                    ok: (perm.isTapped === true) === tapped,
                    detail: `isTapped ${perm.isTapped}, expected ${tapped}`,
                };
            },
        };
    },
    // `skipNextUntap` (PRD #795, CR 302.6/502.1) — a lock on an announced
    // permanent slot is observable as the one-shot `skipNextUntap` flag
    // flipping undefined→true on the seeded filler permanent. An ability's own
    // source is seeded too (issue #3831); a `$each` / spell-site `$source`
    // subject is skipped upstream in `analyseOp` (`subjectPermanentId` returns
    // undefined defensively here).
    skipNextUntap(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "skipNextUntap" }>;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        return {
            label: `lock permanent ${permId} (skipNextUntap undefined→true)`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                return {
                    ok: perm.skipNextUntap === true,
                    detail: `skipNextUntap ${perm.skipNextUntap}, expected true`,
                };
            },
        };
    },
    // `grantAbility` (issue #843, CR 611.2a / 613.1f) — a grant on an announced
    // permanent slot is observable as the keyword appearing in the target's
    // `staticAbilities` (the primitive appends it, and the grant is active for
    // the rest of the turn so it reads immediately after resolution).
    // `$each` / spell-site `$source` targets are skipped upstream in `analyseOp` (returns
    // null defensively here).
    grantAbility(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "grantAbility" }>;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        // The activated-ability (`grantedActivatedId`, issue #738) and
        // triggered-ability (`grantedTriggeredId`, issue #1665) grant variants
        // aren't observable via `staticAbilities` — they land on
        // `grantedActivatedAbilities` / `grantedTriggeredAbilities` instead;
        // their cards carry a hand-written per-card test, so skip them here
        // (return null → smoke test skips).
        // The attack-requirement grant (issue #1972, CR 508.1d) is observable
        // as an entry on the target's `grantedAttackRequirements`.
        if (op.attackRequirement) {
            return {
                label: `grant attack requirement to permanent ${permId}`,
                check: (post) => {
                    const perm = post.players
                        .flatMap((p) => p.battlefield)
                        .find((c) => c.id === permId);
                    if (!perm) {
                        return { ok: false, detail: "target permanent gone" };
                    }
                    const count = perm.grantedAttackRequirements?.length ?? 0;
                    return {
                        ok: count > 0,
                        detail: `grantedAttackRequirements: ${count}`,
                    };
                },
            };
        }
        if (op.ability === undefined) return null;
        const ability = op.ability;
        return {
            label: `grant "${ability}" to permanent ${permId}`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                const has = perm.staticAbilities.includes(ability);
                return {
                    ok: has,
                    detail: has
                        ? `has "${ability}"`
                        : `missing "${ability}" (staticAbilities: ${perm.staticAbilities.join(", ")})`,
                };
            },
        };
    },
    // `animate` (issue #1317, CR 208.2 / 611.1) — never reached: `analyseOp`
    // skips every script with an `animate` Op (a new Op, per-Op regime; the
    // canonical caller targets a LAND, not the generator's creature filler,
    // and asserting a "becomes a creature" shape change doesn't fit the
    // generator's fixed-permanent-kind assumption). Kept for the 1:1 coverage
    // guard; covered by the Op's own hand-written interpreter + wire-format
    // tests instead.
    animate() {
        return null;
    },
    // `setBasePT` (issue #1318, CR 613.4b layer 7b) — never reached: `analyseOp`
    // skips every script with a `setBasePT` Op (a new Op, per-Op regime; the
    // canonical callers use characteristic-filtered targets the generator's
    // filler doesn't satisfy and the outcome is an effective-P/T read outside
    // the smoke vocabulary). Kept for the 1:1 coverage guard; covered by the
    // Op's own hand-written interpreter + wire-format tests instead.
    setBasePT() {
        return null;
    },
    // `addSubtype` (issue #1194, CR 613.1d layer 4) — an add on an announced
    // permanent slot is observable as the subtype appearing in the target's
    // `subtypes` (the primitive appends it immediately, indefinitely).
    // `$each` / spell-site `$source` targets are skipped upstream in `analyseOp` (returns
    // null defensively here).
    addSubtype(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "addSubtype" }>;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        const subtype = op.subtype;
        return {
            label: `add subtype "${subtype}" to permanent ${permId}`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                const has = perm.subtypes.includes(subtype);
                return {
                    ok: has,
                    detail: has
                        ? `has subtype "${subtype}"`
                        : `missing subtype "${subtype}" (subtypes: ${perm.subtypes.join(", ")})`,
                };
            },
        };
    },
    // `delayedTrigger` (CR 603.7, ADR 0048) — never reached: `analyseOp`
    // skips every script with a delayedTrigger Op (the body fires at a
    // future phase boundary the canned scenario never reaches). Kept for the
    // 1:1 coverage guard; scheduling + fire-time coverage is the Op's own
    // interpreter tests (issue #838).
    delayedTrigger() {
        return null;
    },
    // `reflexiveTrigger` (CR 603.12) — never reached: `analyseOp` skips every
    // script with a reflexiveTrigger Op (the body resolves on a SEPARATE
    // stack object, after target announcement and a priority round the canned
    // single-resolution scenario never runs). Kept for the 1:1 coverage
    // guard; queueing, capture round-trip and body execution are covered by
    // the Op's own interpreter tests.
    reflexiveTrigger() {
        return null;
    },
    // `libraryLook` (CR 701.20, issue #844) — never reached: `analyseOp` skips
    // every script with a libraryLook Op (a shuffle is a seeded-PRNG
    // randomization with no deterministic same-resolution outcome the canned
    // scenario can assert). Kept for the 1:1 coverage guard; the shuffle
    // primitive is covered by the Op's own interpreter tests.
    libraryLook() {
        return null;
    },
    // `shuffleSelfIntoLibrary` (CR 608.2 / 701.24, issue #898) — never
    // reached: `analyseOp` skips every script with this Op (a shuffle is a
    // seeded-PRNG randomization with no deterministic same-resolution
    // outcome the canned scenario can assert). Kept for the 1:1 coverage
    // guard; the self-redirect + shuffle is covered by the Op's own
    // interpreter tests.
    shuffleSelfIntoLibrary() {
        return null;
    },
    // `scryReorder` (CR 401.4 / 701.22, issue #885) — never reached: `analyseOp`
    // skips every script with a scryReorder Op (it suspends on a live order-top
    // choice, so there is no deterministic same-resolution outcome the canned
    // scenario can assert). Kept for the 1:1 coverage guard; the look/reorder
    // is covered by the Op's own interpreter tests and the migrated cards'
    // suspension/resume tests.
    scryReorder() {
        return null;
    },
    // `mill` (CR 701.17, issue #885) — never reached: `analyseOp` skips every
    // script with a mill Op (the canned generator does not model milling a
    // target player's library, so there is no graveyard delta it can assert
    // without mis-modelling the source deck). Kept for the 1:1 coverage guard;
    // the mill loop is covered by the Op's own interpreter tests.
    mill() {
        return null;
    },
    // `exileTopOfLibrary` (CR 701.13, issue #3235) — never reached, for the
    // same reason as its `mill` sibling directly above: `analyseOp` skips every
    // script carrying it, since the canned generator seeds only a minimal
    // filler library and there is no library→exile delta it can assert without
    // inventing a deck. Kept for the 1:1 coverage guard; the exile loop, the
    // `linkToSource` stamp and the `bindAll` binding are covered by the Op's
    // own interpreter tests.
    exileTopOfLibrary() {
        return null;
    },
    // `revealTopAndRoute` (CR 701.20a) — never reached: `analyseOp` skips every
    // script carrying one (the canned generator seeds a minimal filler library
    // and cannot provision a KNOWN top card, so which route fires is
    // unpredictable and any delta would be a mis-assertion). Kept for the 1:1
    // coverage guard; both the matching route and the fallback are covered by
    // the Op's own interpreter tests.
    revealTopAndRoute() {
        return null;
    },
    // `revealUntilMatch` (CR 701.20a, issue #2707) — never reached: `analyseOp`
    // skips every script carrying one (the revealed prefix's size depends on
    // the library composition the canned generator cannot provision, so any
    // delta would be a mis-assertion). Kept for the 1:1 coverage guard; the
    // match, no-match and empty-library branches are covered by the Op's own
    // interpreter tests.
    revealUntilMatch() {
        return null;
    },
    // `explore` (CR 701.44, issue #2376) — never reached: `analyseOp` skips
    // every script with an explore Op (the canned generator cannot provision a
    // known top card, so it cannot predict the land-vs-nonland branch, and the
    // nonland branch suspends on a live keep-or-bin choice). Kept for the 1:1
    // coverage guard; both branches are covered by the Op's own interpreter
    // tests.
    explore() {
        return null;
    },
    // `discardAtRandom` (CR 701.9a, PRD #795) — never reached: `analyseOp`
    // skips every script with a discardAtRandom Op (the canned generator does
    // not provision a target player's hand with a known count, so there is no
    // hand-size delta it can assert without mis-modelling the target's hand).
    // Kept for the 1:1 coverage guard; the random-discard loop is covered by
    // the Op's own interpreter tests.
    discardAtRandom() {
        return null;
    },
    // `randomExileToHand` (CR 400.7, issue #1947) — never reached:
    // `analyseOp` skips every script with this Op (the canned generator
    // does not provision a source-linked exile pile, so there is no
    // deterministic pick it can assert). Kept for the 1:1 coverage guard;
    // the random pick is covered by the Op's own interpreter tests.
    randomExileToHand() {
        return null;
    },
    // `lookDistribute` (CR 401.4, issue #984) — never reached: `analyseOp` skips
    // every script with a lookDistribute Op (it suspends on a live look-distribute
    // pick, so there is no deterministic same-resolution outcome the canned
    // scenario can assert). Kept for the 1:1 coverage guard; the look / keep /
    // bottom is covered by the Op's own interpreter tests.
    lookDistribute() {
        return null;
    },
    // `hideaway` (CR 702.75a, issue #783) — never reached: `analyseOp` skips
    // every script carrying it (it suspends on a live look-distribute pick).
    // Kept for the 1:1 coverage guard; the look / face-down exile / CR 607 link
    // / random bottom is covered by the Op's own interpreter tests.
    hideaway() {
        return null;
    },
    // `revealAndCategorize` (CR 701.20a / 401.4, issue #1364) — never reached:
    // `analyseOp` skips every script carrying it (it suspends on a live
    // categorized look-distribute pick). Kept for the 1:1 coverage guard; the
    // reveal / per-category keep / bottom split is covered by the Op's own
    // interpreter tests and `categorizedPick`'s matching unit tests.
    revealAndCategorize() {
        return null;
    },
    // `chooseCategorized` (CR 601.2b / 701.9, issue #1945) — never reached:
    // `analyseOp` skips every script carrying it (it suspends on a live
    // choose-categorized pick). Kept for the 1:1 coverage guard; the
    // per-category keep / discard-or-sacrifice sweep / bounce is covered by the Op's own
    // interpreter tests and `categorizedPick`'s matching unit tests.
    chooseCategorized() {
        return null;
    },
    // `putBack` (CR 401.4, issue #1046) — never reached: `analyseOp` skips
    // every script with a putBack Op (it suspends on a live choose-hand-card
    // pick whose ORDER the player controls, so there is no deterministic
    // same-resolution outcome the canned scenario can assert). Kept for the
    // 1:1 coverage guard; the suspend/resume, pick-order-preserving top
    // placement and checkpoint are covered by the Op's own interpreter tests.
    putBack() {
        return null;
    },
    // `preventDamage` (CR 615, issue #845) — never reached: `analyseOp` skips
    // every script with a preventDamage Op (a shield sits dormant until a later
    // damage event, with no same-resolution outcome the canned scenario can
    // assert). Kept for the 1:1 coverage guard; shield registration and
    // consumption are covered by the Op's own interpreter tests.
    preventDamage() {
        return null;
    },
    // `redirectDamage` (CR 614.9, issue #3810) — never reached: `analyseOp`
    // skips every script carrying one, for the same dormant-shield reason.
    // Kept for the 1:1 coverage guard.
    redirectDamage() {
        return null;
    },
    // `regenerate` (CR 701.19a, issue #846) — the shield's REGISTRATION is
    // observable as the permanent's `regenerationShields` count rising by one;
    // its consumption (a later destroy) is the Op's own interpreter tests.
    regenerate(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "regenerate" }>;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        const permBefore = pre.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === permId);
        if (!permBefore) return null;
        const expected = (permBefore.regenerationShields ?? 0) + 1;
        return {
            label: `regeneration shield on permanent ${permId} (shields →${expected})`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                const actual = perm.regenerationShields ?? 0;
                return {
                    ok: actual === expected,
                    detail: `regenerationShields ${actual}, expected ${expected}`,
                };
            },
        };
    },
    // `preventRegeneration` (CR 701.19c, issue #1283) — a lock on an announced
    // permanent slot is observable as the `cantBeRegeneratedThisTurn` flag
    // flipping undefined→true on the seeded filler creature. An ability's own
    // source is seeded too (issue #3831); a `$each` / spell-site `$source`
    // subject is skipped upstream in `analyseOp` (`subjectPermanentId` returns
    // undefined defensively here).
    preventRegeneration(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "preventRegeneration" }>;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        return {
            label: `regen-lock permanent ${permId} (cantBeRegeneratedThisTurn undefined→true)`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                return {
                    ok: perm.cantBeRegeneratedThisTurn === true,
                    detail: `cantBeRegeneratedThisTurn ${perm.cantBeRegeneratedThisTurn}, expected true`,
                };
            },
        };
    },
    // `exileOnDeath` (CR 614.1a, issue #1095) — a death replacement armed on an
    // announced permanent slot is observable as the `exileOnDeath` flag
    // flipping undefined→true on the seeded filler creature (the generator
    // seeds CREATURES, which is what `setExileOnDeath` requires).
    // `$each` / spell-site `$source` targets are skipped upstream in `analyseOp` (returns
    // null defensively here).
    exileOnDeath(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "exileOnDeath" }>;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        return {
            label: `exile-on-death permanent ${permId} (exileOnDeath undefined→true)`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                return {
                    ok: perm.exileOnDeath === true,
                    detail: `exileOnDeath ${perm.exileOnDeath}, expected true`,
                };
            },
        };
    },
    // `lockDamage` (CR 615.12 / 614.9, issue #2231) — the turn-scoped
    // anti-prevention / anti-redirection lock on an announced permanent slot is
    // observable as the `damageLockThisTurn` flag flipping undefined→true on
    // the seeded filler creature (the generator seeds CREATURES, which is what
    // `setDamageLockThisTurn` requires). `$each` / spell-site `$source` targets are skipped
    // upstream in `analyseOp` (returns null defensively here).
    lockDamage(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "lockDamage" }>;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        return {
            label: `damage-lock permanent ${permId} (damageLockThisTurn undefined→true)`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                return {
                    ok: perm.damageLockThisTurn === true,
                    detail: `damageLockThisTurn ${perm.damageLockThisTurn}, expected true`,
                };
            },
        };
    },
    // `suppressDamagePrevention` (CR 615.12, issue #3303) — the GAME-scoped
    // turn-long anti-prevention lock is observable as
    // `state.damageUnpreventableThisTurn` flipping undefined→true in the same
    // resolution. No seeded slot to read: the Op names no object.
    suppressDamagePrevention() {
        return {
            label: "game damage lock (damageUnpreventableThisTurn undefined→true)",
            check: (post) => ({
                ok: post.damageUnpreventableThisTurn === true,
                detail: `damageUnpreventableThisTurn ${post.damageUnpreventableThisTurn}, expected true`,
            }),
        };
    },
    // `markAssignsNoCombatDamage` (CR 510.1c, issue #1283) — a source-side
    // combat-damage lock on an announced permanent slot is observable as a
    // combat-only SOURCE-scoped shield covering the permanent's id
    // (`state.sourcePreventionShields`, issue #1955). An ability's own
    // source is seeded too (issue #3831); a `$each` / spell-site `$source`
    // subject is skipped upstream in `analyseOp` (`subjectPermanentId` returns
    // undefined defensively here).
    markAssignsNoCombatDamage(rawOp, scenario) {
        const op = rawOp as Extract<
            EffectOp,
            { op: "markAssignsNoCombatDamage" }
        >;
        const permId = subjectPermanentId(scenario, op.target);
        if (permId === undefined) return null;
        return {
            label: `combat-damage lock permanent ${permId} (source-scoped combat shield covers id)`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                const marked = (post.sourcePreventionShields ?? []).some((s) =>
                    s.sourceIds?.includes(permId)
                );
                return {
                    ok: marked,
                    detail: `sourcePreventionShields ${marked ? "covers" : "misses"} ${permId}`,
                };
            },
        };
    },
    // `transform` (CR 701.27 / 712, issue #1210) — never reached: `analyseOp`
    // skips every script with a transform Op (a characteristic-set swap has
    // no same-resolution outcome the canned scenario's numeric assertion
    // vocabulary models). Kept for the 1:1 coverage guard; the front/back
    // definition swap is covered by the Op's own interpreter tests.
    transform() {
        return null;
    },
    // `exileAndReturnTransformed` (CR 712 / 400.7, issue #2380) — never
    // reached: `analyseOp` skips every script carrying it, for the same reason
    // as `transform` above plus the absence of a `backFace` on any canned
    // permanent. Kept for the 1:1 coverage guard; the exile/return round trip,
    // the CR 400.7 new-object semantics and the CR 306.5b starting loyalty are
    // covered by the Op's own interpreter tests.
    exileAndReturnTransformed() {
        return null;
    },
    // `gainControl` (CR 613.1b, issue #848) — never reached: `analyseOp` skips
    // every script with a gainControl Op (the canned scenario seeds no permanent
    // under another player to steal, and the conditional durations only hold
    // while the source is tapped/controlled — state the generator does not
    // construct — so there is no same-resolution outcome it can assert). Kept
    // for the 1:1 coverage guard; the control change and its conditional revert
    // are covered by the Op's own interpreter tests.
    gainControl() {
        return null;
    },
    // `becomeMonarch` (CR 720.2, issue #1199) — never reached: `analyseOp`
    // skips every script with a becomeMonarch Op (crowning the monarch is a
    // GLOBAL designation, not a per-permanent / per-player-resource outcome
    // the canned scenario's assertion vocabulary models). Kept for the 1:1
    // coverage guard; covered by the Op's own interpreter tests.
    becomeMonarch() {
        return null;
    },
    // `optionChoice` (CR 700.2 / 601.2b, issue #849) — never reached: `analyseOp`
    // skips every script with an optionChoice Op (it suspends on a live mode
    // pick, so there is no same-resolution outcome the canned scenario can
    // assert). Kept for the 1:1 coverage guard; mode selection and each branch's
    // execution are covered by the Op's own interpreter tests.
    optionChoice() {
        return null;
    },
    // `coinFlip` (CR 705, issue #851) — never reached: `analyseOp` skips every
    // script with a coinFlip Op (it draws a RANDOM bit and suspends for the
    // reveal, so there is no deterministic same-resolution outcome the canned
    // scenario can assert). Kept for the 1:1 coverage guard; the flip, both
    // branches and the no-re-roll resume are covered by the Op's own interpreter
    // tests (per-Op regime).
    coinFlip() {
        return null;
    },
    // `coinFlipSync` (CR 705, issue #1281) — never reached: `analyseOp` skips
    // every script with a coinFlipSync Op (it draws a RANDOM bit — no fixed
    // seed to assert a specific branch against). Kept for the 1:1 coverage
    // guard; the flip and both branches are covered by the Op's own
    // interpreter tests (per-Op regime).
    coinFlipSync() {
        return null;
    },
    // `createToken` (CR 111 / 701.7, issue #847) — a deterministic
    // same-resolution outcome: `count` token permanents matching the spec's
    // types + P/T appear on the controller's battlefield (the canned scenario
    // seeds no tokens). Asserted directly rather than skipped.
    createToken(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "createToken" }>;
        if (op.count !== undefined && typeof op.count !== "number") return null;
        // CR 208.2 (issue #2384) — `power`/`toughness` may be a full
        // `EffectValue` (an X/X token sized off a ref at resolution). The
        // canned scenario can only assert a FIXED size, so a dynamic one is
        // declined here exactly like a dynamic `count` above; the Op's own
        // interpreter test covers the resolved-size path.
        const tokenPower = op.token.power;
        const tokenToughness = op.token.toughness;
        if (tokenPower !== undefined && typeof tokenPower !== "number") {
            return null;
        }
        if (
            tokenToughness !== undefined &&
            typeof tokenToughness !== "number"
        ) {
            return null;
        }
        const count = op.count ?? 1;
        const pid = assertionPlayerId(op.controller);
        const matches = (c: CardInstanceState) =>
            c.isToken === true &&
            c.power === tokenPower &&
            c.toughness === tokenToughness &&
            c.types.length === op.token.types.length &&
            c.types.every((t) => op.token.types.includes(t));
        const before = findPlayer(pre, pid).battlefield.filter(matches).length;
        const expected = before + count;
        return {
            label: `createToken ${count}× ${op.token.types.join("/")} ${tokenPower ?? "-"}/${tokenToughness ?? "-"} for player ${pid} (${before}→${expected})`,
            check: (post) => {
                const now = findPlayer(post, pid).battlefield.filter(
                    matches
                ).length;
                return {
                    ok: now === expected,
                    detail: `matching tokens ${now}, expected ${expected}`,
                };
            },
        };
    },
    // `createTokenCopy` (CR 707.2 + CR 111.1, issue #1459) — never reached:
    // `analyseOp` skips every script with this Op (it copies a RUNTIME source
    // permanent — an announced target slot or a `ref` to a permanent bound
    // earlier in the script — which the canned generator seeds no determinate
    // copyable source for). Kept for the 1:1 coverage guard; the Op's own
    // interpreter + wire-format tests (both source shapes + count) are the
    // behavioural guarantor.
    createTokenCopy() {
        return null;
    },
    // `becomeCopy` (CR 707.2 / 611.2a, issue #3236) — never reached:
    // `analyseOp` skips every script with this Op (the canned fillers are
    // identical, so a copy between them is unobservable, and the timed revert
    // needs a phase boundary). Kept for the 1:1 coverage guard; the Op's own
    // interpreter + wire-format tests are the behavioural guarantor.
    becomeCopy() {
        return null;
    },
    // `emblem` (CR 114, issue #1221) — a deterministic same-resolution outcome:
    // one command-zone emblem with the named key appears in `GameState.emblems`,
    // owned by the resolved controller (the canned scenario seeds no emblems).
    emblem(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "emblem" }>;
        const ctrl = op.controller ?? "controller";
        if (ctrl !== "controller" && ctrl !== "opponent") return null;
        const pid = assertionPlayerId(ctrl);
        const matches = (e: { emblemId: string; ownerId: string }) =>
            e.emblemId === op.emblem && e.ownerId === pid;
        const before = (pre.emblems ?? []).filter(matches).length;
        const expected = before + 1;
        return {
            label: `emblem "${op.emblem}" for player ${pid} (${before}→${expected})`,
            check: (post) => {
                const now = (post.emblems ?? []).filter(matches).length;
                return {
                    ok: now === expected,
                    detail: `matching emblems ${now}, expected ${expected}`,
                };
            },
        };
    },
    // Zone change: exile moves the target to its owner's exile zone (CR 701.13).
    exile(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "exile" }>;
        if (!("target" in op.target)) return null; // $each — skipped upstream
        const permId = scenario.targetPermanentIds[op.target.target];
        return {
            label: `exile moves target permanent ${permId} to exile`,
            check: (post) => {
                const onBf = post.players
                    .flatMap((p) => p.battlefield)
                    .some((c) => c.id === permId);
                const inExile = post.players
                    .flatMap((p) => p.exile)
                    .some((c) => c.id === permId);
                return {
                    ok: !onBf && inExile,
                    detail: `onBattlefield=${onBf} inExile=${inExile}`,
                };
            },
        };
    },
    // `exileWithAttachments` (CR 603.7a / 701.13 / ADR 0028) — never reached:
    // `analyseOp` skips every script with it (the exile lands in an `exileHeld`
    // bundle, not the plain exile zone this generator's board-delta assertion
    // models, and the observable return needs a later source-leaves/untaps
    // step). Kept for the 1:1 coverage guard; the Op's own interpreter tests
    // are the behavioural guarantor.
    exileWithAttachments() {
        return null;
    },
    // `exileSelf` (CR 608.2, issue #1097) — never reached: `analyseOp` skips
    // every script with this Op (the canned generator's assertion vocabulary
    // — battlefield/graveyard/life/counter deltas — has no hook for "where
    // did the resolving spell card itself land", same rationale as
    // `shuffleSelfIntoLibrary` below, just a different destination zone).
    // Kept for the 1:1 coverage guard; the self-redirect is covered by the
    // Op's own interpreter tests.
    exileSelf() {
        return null;
    },
    // `returnExiledForSource` (CR 603.7a / ADR 0028) — never reached:
    // `analyseOp` skips every script with it (its outcome is only observable
    // after a prior `exileWithAttachments` armed a bundle, which the generator
    // doesn't sequence). Kept for the 1:1 coverage guard; the Op's own
    // interpreter tests are the behavioural guarantor.
    returnExiledForSource() {
        return null;
    },
    // `captureBinding` / `recallCapturedBinding` (CR 608.2h / 400.7, issue
    // #2384) — never reached: `analyseOp` skips every script carrying either,
    // because the channel spans two separate resolutions of two different
    // abilities of the same source and a canned scenario resolves one stack
    // item. Kept for the 1:1 coverage guard; the Ops' own interpreter tests are
    // the behavioural guarantor.
    captureBinding() {
        return null;
    },
    recallCapturedBinding() {
        return null;
    },
    // `dealDamageDividedAsChosen` (CR 601.2d / 120.4) — never reached:
    // `analyseOp` skips every script with it (the per-target division is chosen
    // at announcement and snapshotted onto the stack item's `targetAmounts`,
    // which the canned generator has no way to populate). Kept for the 1:1
    // coverage guard; the Op's own interpreter tests are the behavioural
    // guarantor.
    dealDamageDividedAsChosen() {
        return null;
    },
    // `winGame` (CR 104.2a, issue #1066) — never reached: `analyseOp` skips
    // every script with a winGame Op (it sets `state.gameOver`, a
    // qualitatively different post-state the canned scenario's board/life
    // assertions don't model). Kept for the 1:1 coverage guard; the Op's own
    // interpreter test (plus Coalition Victory's card-level predicate test)
    // is the behavioural guarantor.
    winGame() {
        return null;
    },
    // `divideIntoPiles` (ADR 0053, pile division, issue #1067) — never
    // reached: `analyseOp` skips every script with this Op (it suspends
    // TWICE for two DIFFERENT players' live picks, which the canned
    // generator cannot drive). Kept for the 1:1 coverage guard; each of the
    // six pile cards has its own hand-written interpreter + wire-format test
    // (the per-Op regime).
    divideIntoPiles() {
        return null;
    },
    // `restrictCombat` (CR 508.1a/509.1b, ADR 0053) — never reached:
    // `analyseOp` skips every script with this Op (its only observable
    // effect is at a LATER declare-attackers/-blockers step, outside the
    // canned generator's immediate-post-resolution board/life assertions).
    // Kept for the 1:1 coverage guard; the Op's own interpreter test plus
    // Fight or Flight / Stand or Fall's hand-written combat tests are the
    // behavioural guarantor.
    restrictCombat() {
        return null;
    },
    // `extraTurn` (CR 500.7, issue #686) — never reached: `analyseOp` skips
    // every script with this Op (it mutates the turn-boundary `extraTurns`
    // queue, not a same-step board/life delta the canned generator's
    // immediate-post-resolution assertions can size). Kept for the 1:1
    // coverage guard; the Op's own interpreter test plus Time Warp's
    // hand-written card test (tmp/__tests__/blue.test.ts) are the
    // behavioural guarantor.
    extraTurn() {
        return null;
    },
    // `extraCombat` (CR 500.8, issue #2886) — never reached: `analyseOp` skips
    // every script with this Op (it mutates the turn-structure `extraPhases`
    // queue, not a same-step board/life delta the canned generator's
    // immediate-post-resolution assertions can size). Kept for the 1:1
    // coverage guard; the Op's own interpreter test plus the extra-phase seam
    // tests (`gre/__tests__/extraPhases.test.ts`) are the behavioural
    // guarantor.
    extraCombat() {
        return null;
    },
    // `skipNextTurn` (CR 614.10, issue #1957) — never reached: `analyseOp`
    // skips every script with this Op (it mutates the turn-boundary
    // `skipNextTurn` count, not a same-step board/life delta the canned
    // generator's immediate-post-resolution assertions can size). Kept for
    // the 1:1 coverage guard; the Op's own interpreter test plus Waterspout
    // Elemental's hand-written card test are the behavioural guarantor.
    skipNextTurn() {
        return null;
    },
    // `setColor` (CR 613.1e layer 5, issue #1083) — never reached: `analyseOp`
    // skips every script with a setColor Op (every shipped INV caller composes
    // it inside a suspending `optionChoice`/`forEach`, both of which already
    // skip wholesale before descending into their body). Kept for the 1:1
    // coverage guard; the Op's own interpreter + wire-format tests are the
    // behavioural guarantor.
    setColor() {
        return null;
    },
    // `setSubtype` (CR 305.7 layer 4, issue #1083) — never reached: `analyseOp`
    // skips every script with a setSubtype Op (the shipped caller, Dream
    // Thrush, composes it inside a suspending `optionChoice`, which already
    // skips before descending). Kept for the 1:1 coverage guard; the Op's own
    // interpreter + wire-format tests are the behavioural guarantor.
    setSubtype() {
        return null;
    },
    // `setCardTypes` (CR 205.1a layer 4, issue #2361) — never reached:
    // `analyseOp` skips every script with a setCardTypes Op (it changes the
    // target's basic kind mid-scenario, which the canned target-seeding does
    // not model). Kept for the 1:1 coverage guard; the Op's own interpreter +
    // wire-format tests are the behavioural guarantor.
    setCardTypes() {
        return null;
    },
    // `loseAllAbilities` (CR 613.1f layer 6, issue #2361) — never reached:
    // `analyseOp` skips every script with a loseAllAbilities Op (the canned
    // filler permanent has no abilities to lose, so any assertion would be
    // vacuous). Kept for the 1:1 coverage guard; the Op's own interpreter +
    // wire-format tests are the behavioural guarantor.
    loseAllAbilities() {
        return null;
    },
    // `loseAllAbilitiesWhileSourceRemains` (CR 613.1f layer 6, issue #1562) —
    // never reached: `analyseOp` skips every script with this Op (same
    // reasoning as `loseAllAbilities` above, plus its target must resolve to
    // a countered-ability stack object the canned generator never produces).
    // Kept for the 1:1 coverage guard; the Op's own interpreter + wire-format
    // tests are the behavioural guarantor.
    loseAllAbilitiesWhileSourceRemains() {
        return null;
    },
    // `nameCard` (CR 201.3 / 202.3, issue #1085) — never reached: `analyseOp`
    // skips every script with a nameCard Op (it suspends for a live
    // open-ended name choice, which the canned generator cannot submit).
    // Kept for the 1:1 coverage guard; the Op's own interpreter tests are
    // the behavioural guarantor.
    nameCard() {
        return null;
    },
    // `chooseCreatureType` (CR 205.3m, issue #3721) — never reached:
    // `analyseOp` skips every script carrying it (it suspends for a live pick
    // out of the ~280-entry creature-type table, which the canned generator
    // cannot submit). Kept for the 1:1 coverage guard; the Op's own
    // interpreter tests are the behavioural guarantor.
    chooseCreatureType() {
        return null;
    },
    // `digMatchingToHand` (CR 701.20a / 401.4, issue #1085) — never reached:
    // `analyseOp` skips every script with this Op (its outcome depends on a
    // filter match against library contents the canned generator's filler
    // library doesn't model deterministically; every shipped caller also
    // pairs it with a `nameCard` Op that already skips wholesale). Kept for
    // the 1:1 coverage guard; the Op's own interpreter tests are the
    // behavioural guarantor.
    digMatchingToHand() {
        return null;
    },
    // `castDuringResolution` (CR 608.2f, issue #1477) — never reached:
    // `analyseOp` skips every script with this Op (it suspends for a live
    // Cast/Decline plus the cast card's own targets/modes/X, which the canned
    // generator can't drive). Kept for the 1:1 coverage guard; the Op's own
    // interpreter tests are the behavioural guarantor.
    castDuringResolution() {
        return null;
    },
    // `cascade` (CR 702.85a, issue #3216) — never reached: `analyseOp` skips
    // every script with this Op (it needs its own spell on the stack for the
    // mana-value threshold and suspends for the free cast's Cast/Decline).
    // Kept for the 1:1 coverage guard; the Op's own interpreter tests are the
    // behavioural guarantor.
    cascade() {
        return null;
    },
    // `setIslandSanctuaryProtection` (CR 508.1c, issue #1283) — never reached:
    // `analyseOp` skips every script with this Op (its only observable effect
    // is at a LATER declare-attackers step, and its shipped consumer wraps it
    // in an `optionChoice` mode, which already skips wholesale). Kept for the
    // 1:1 coverage guard; the Op's own interpreter test plus Island
    // Sanctuary's hand-written combat test are the behavioural guarantor.
    setIslandSanctuaryProtection() {
        return null;
    },
    // `setProtectionFromEverything` (CR 702.16b/e/i, issue #674) — never
    // reached: `analyseOp` skips every script with this Op (a global
    // player-scoped designation whose effects only manifest against a LATER
    // spell or damage event). Kept for the 1:1 coverage guard; the Op's own
    // interpreter tests plus The One Ring's hand-written targeting/damage/
    // expiry tests are the behavioural guarantor.
    setProtectionFromEverything() {
        return null;
    },
    // `rangedTopdeck` (CR 119.4 / 121.1, issue #1283) — never reached:
    // `analyseOp` skips every script with this Op (it suspends for a live
    // ranged hand pick, and its shipped consumer wraps it in a `mayPay`+`if`
    // body, which already skips wholesale). Kept for the 1:1 coverage guard;
    // the Op's own interpreter tests (per-Op regime) plus Sylvan Library's
    // hand-written per-card tests are the behavioural guarantor.
    rangedTopdeck() {
        return null;
    },
};

/** Op kinds the generator has an assertor for — used by the coverage guard
 *  test to keep this in exact 1:1 correspondence with `EFFECT_OP_REGISTRY`.
 *  A newly-registered Op with no assertor here fails that test, forcing smoke
 *  coverage before it can ship. */
export const ASSERTED_OP_KINDS: readonly string[] = Object.keys(OP_ASSERTORS);

/** True when every registered Op has both an analyser branch and an assertor —
 *  the generator can, in principle, cover the whole vocabulary. Exposed for the
 *  coverage guard test. */
export function opCoverageGaps(): string[] {
    const gaps: string[] = [];
    for (const row of EFFECT_OP_REGISTRY) {
        if (!(row.op in OP_ASSERTORS)) {
            gaps.push(
                `Op "${row.op}" has no assertor in scenarioGenerator.ts OP_ASSERTORS`
            );
        }
    }
    return gaps;
}

// --- Public entry point -----------------------------------------------------

/** Builds a full plan (scenario + assertions) for one Effect Script, or a skip
 *  with a reason. `effects` may be a spell or an ability script (the caller
 *  supplies the site-appropriate stack item); `host` says which, because only
 *  an ability has a source permanent for `$source` to name (issue #3831) —
 *  and, at an ability site, WHAT that source is and WHERE it is at resolution
 *  (issue #3879). It defaults to `SPELL_HOST` — fail-closed: a caller that
 *  does not say an ability is hosting the script gets no `$source` seeded, and
 *  a skip. A script with no assertable Op (every Op skipped by its assertor —
 *  e.g. all amounts are refs) is reported as a skip so it never counts as
 *  passing. */
export function planSmokeTest(
    effects: readonly EffectOp[],
    host: SmokeHost = SPELL_HOST
): Plan {
    if (effects.length === 0) {
        return skipPlan([
            { code: "no-assertable-outcome", reason: "empty effect script" },
        ]);
    }

    const req = emptyRequirements(host);
    for (const op of effects) analyseOpFully(op, req);

    const built = buildScenario(req);
    if ("skip" in built) {
        // ADR 0105 § 7.1 — a skipped script's NESTED Ops are analysed too.
        // `analyseOp` stops at a container (`if`, `forEach`, `mayPay`'s
        // `if`-guarded body, a delayed trigger's payload), so without this the
        // container's skip is the only one recorded — and an `op-covered`
        // container (`if` branches on a runtime predicate) would hide a
        // `card-dependent` clause in its body (`moveZone` of an unmodelled
        // object). Only a skipped script is walked: a script that RUNS is
        // asserted as it is, and walking it could only invent reasons.
        //
        // The nested walk is always a SPELL-site walk, whatever hosts the
        // script (issue #3831 review): it reads Ops that will NOT run — the
        // plan has already skipped — so the seeded source proves nothing about
        // them, and accepting a `$source` subject here would let an op-covered
        // container (`mayPay` + `if`) hide a body acting on `$source`. That is
        // the very fail-open this walk exists to close (ADR 0105 § 7.1).
        const nested = emptyRequirements(SPELL_HOST);
        for (const op of nestedOps(effects)) analyseOpFully(op, nested);
        return skipPlan([...built.skip, ...nested.skips]);
    }

    const assertions: Assertion[] = [];
    for (const op of effects) {
        const assertor = OP_ASSERTORS[op.op];
        if (!assertor) {
            return skipPlan([
                {
                    code: "unanalysed",
                    reason: `Op "${op.op}" has no assertor`,
                    op,
                },
            ]);
        }
        const a = assertor(op, built, built.state);
        if (a) assertions.push(a);
    }
    if (assertions.length === 0) {
        return skipPlan([
            {
                code: "no-assertable-outcome",
                reason: "no assertable outcome — every Op's outcome depends on a runtime ref",
            },
        ]);
    }
    return { kind: "run", scenario: built, assertions };
}

function emptyRequirements(host: SmokeHost): Requirements {
    return {
        targetSlots: new Map(),
        drawingPlayers: new Set(),
        countSets: [],
        skips: [],
        host,
        sourceSubject: false,
    };
}

function skipPlan(skips: SmokeSkip[]): Plan {
    return { kind: "skip", reason: skips[0]!.reason, skips };
}

/** Every Effect Script Op held INSIDE `effects`' Ops (a branch, a loop body, a
 *  payload), at any depth — the top-level Ops themselves excluded. */
function nestedOps(effects: readonly EffectOp[]): EffectOp[] {
    const found: EffectOp[] = [];
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const child of node) walk(child);
            return;
        }
        if (node === null || typeof node !== "object") return;
        if (isEffectOp(node)) found.push(node);
        for (const value of Object.values(node)) walk(value);
    };
    for (const op of effects) {
        for (const value of Object.values(op)) walk(value);
    }
    return found;
}
