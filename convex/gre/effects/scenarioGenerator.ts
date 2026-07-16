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
    CardDefinition,
    EffectCountSpec,
    EffectOp,
    EffectPlayerRef,
    EffectValue,
    TargetSelection,
} from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";
import { EFFECT_OP_REGISTRY } from "../../cards/mechanicsRegistry";
import { getEffectivePower, getEffectiveToughness } from "../layers";
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
    /** True when the script targets a player in at least one slot (drives the
     *  synthetic card's `targetRequirement`). */
    targetKind: "player" | "permanent" | "none";
}

/** The generator's verdict for one script: either a runnable scenario +
 *  assertions, or an explicit skip carrying a human-readable reason. A skip is
 *  surfaced by the sweep (never silently green — ADR 0045 / issue #804). */
export type Plan =
    | { kind: "run"; scenario: Scenario; assertions: Assertion[] }
    | { kind: "skip"; reason: string };

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
    subtype?: string | string[];
}): string {
    // issue #677 — `type`/`subtype` may be an OR-array; a single representative
    // filler matching the FIRST value is enough for a canned scenario's count.
    const type =
        (Array.isArray(filter.type) ? filter.type[0] : filter.type) ??
        "Creature";
    const subtype =
        (Array.isArray(filter.subtype) ? filter.subtype[0] : filter.subtype) ??
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
    /** Present when the script cannot be scenario-ized. */
    skip: string | null;
}

function analyseValue(value: EffectValue, req: Requirements): void {
    if (typeof value === "number") return;
    if ("ref" in value) {
        req.skip ??= `numeric ref "${value.ref}" — amount depends on a runtime snapshot`;
        return;
    }
    // Chosen-cost X (issue #852): the amount is whatever was announced for {X}
    // at cast time. The canned scenario pushes the spell directly on the stack
    // without a cast, so getX() would read 0 — the declared outcome can't be
    // asserted deterministically. Skip-with-reason (the per-card test remains
    // the behavioural guarantor for X cards).
    if ("X" in value) {
        req.skip ??= `amount is chosen-cost X — depends on the value announced for {X} at cast time`;
        return;
    }
    // counters (issue #1015, CR 122.6): the amount reads the LIVE count of a
    // counter type on a selected permanent. The canned generator does not
    // pre-seed counters on its filler permanents, so the count would be 0 and
    // the declared outcome can't be asserted deterministically. Skip-with-reason
    // — the construct's interpreter test (across $source / $each / target) is
    // the behavioural guarantor (per DSL-first authoring, new-construct regime).
    if ("counters" in value) {
        req.skip ??= `amount reads a permanent's "${value.counters.type}" counter count — the canned generator does not pre-seed counters`;
        return;
    }
    // kickerCount (CR 702.33): the amount reads how many times the spell was
    // kicked, a cast-time decision the canned generator (which casts unkicked)
    // can't reproduce. Skip-with-reason — the per-card / interpreter test is the
    // behavioural guarantor (per DSL-first authoring, new-construct regime).
    if ("kickerCount" in value) {
        req.skip ??= `amount reads the spell's kicker count — the canned generator casts unkicked`;
        return;
    }
    // manaValue (CR 202.3): the amount reads a selected object's mana value. The
    // canned generator's filler permanents have no controlled mana value the
    // predictor can size a declared outcome against; skip-with-reason — the
    // per-card / interpreter test is the behavioural guarantor.
    if ("manaValue" in value) {
        req.skip ??= `amount reads a selected object's mana value — not faithfully sizable in a canned scenario`;
        return;
    }
    // domain (CR 702 preamble, issue #1066): the amount reads a PLAYER's
    // Domain (distinct basic land types among lands controlled). The canned
    // generator's filler board has no basic lands the predictor can size a
    // declared outcome against; skip-with-reason — the value member's own
    // interpreter test (across the `of` player selectors) is the behavioural
    // guarantor (per DSL-first authoring, new-construct regime).
    if ("domain" in value) {
        req.skip ??= `amount reads a player's Domain — the canned generator does not seed basic lands to size it`;
        return;
    }
    // escaped (CR 702.138e, issue #695): a 0/1 read of whether a permanent
    // escaped. The canned generator casts spells from hand, never via escape, so
    // it can't set an escaped=1 outcome; skip-with-reason — the value member's
    // own interpreter test is the behavioural guarantor (new-construct regime).
    if ("escaped" in value) {
        req.skip ??= `amount reads a permanent's escaped flag — the canned generator does not cast via escape`;
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
        req.skip ??= `amount reads the resolving triggered ability's per-turn resolution count — not modelled by the canned single-shot generator`;
        return;
    }
    req.countSets.push(value.count);
    // A count set's own controller may itself be a ref — unmodelable.
    const c = value.count.controller;
    if (typeof c === "object" && c !== null && "ref" in c) {
        req.skip ??= `count set controller is a ref "${c.ref}"`;
    }
    // issue #985 — the filler seeds ONE player's zone with cards matched by
    // type/subtype only. An `acrossAllPlayers` scope (every graveyard) or a
    // `name` filter (an exact printed name the filler doesn't synthesize) can't
    // be faithfully sized here; skip-with-reason so a hand-written test is the
    // behavioural guarantor (per DSL-first authoring, new-construct regime).
    if (value.count.acrossAllPlayers) {
        req.skip ??= `count set spans all players' zones — not faithfully sizable in a canned scenario`;
    }
    if (value.count.filter?.name !== undefined) {
        req.skip ??= `count set filters by card name "${value.count.filter.name}" — filler doesn't synthesize an exact name`;
    }
    // issue #999 — the filler seeds cards by type/subtype only and predicts a
    // plain cardinality. A supertype-exclusion filter ("nonbasic land") or a
    // `times` multiplier ("twice the number of …") aren't modelled by the
    // seeder/predictor, so skip-with-reason — the construct's hand-written
    // interpreter test is the behavioural guarantor (new-construct regime).
    if (value.count.filter?.excludeSupertype !== undefined) {
        req.skip ??= `count set excludes supertype(s) — the filler doesn't model supertype exclusion`;
    }
    if (value.count.times !== undefined) {
        req.skip ??= `count set applies a ${value.count.times}× multiplier — not modelled by the canned predictor`;
    }
}

function analysePlayer(
    ref: EffectPlayerRef,
    slotUse: Requirements,
    forDraw: boolean
): void {
    const resolved = resolveScenarioPlayer(ref);
    if (resolved === "ref") {
        slotUse.skip ??= `player parameter is a ref — recipient depends on a runtime snapshot`;
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
        req.skip ??= `target slot ${slot} is read as both ${existing} and ${kind}`;
        return;
    }
    req.targetSlots.set(slot, kind);
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
            } else {
                // `{ ref: "$each" }` — only reachable inside a forEach body,
                // and forEach scripts are skipped wholesale below.
                req.skip ??= `object ref "${op.to.ref}" — recipient depends on a forEach iteration`;
            }
            return;
        case "draw":
            analysePlayer(op.player, req, true);
            analyseValue(op.count, req);
            return;
        case "gainLife":
        case "loseLife":
        case "getEnergy":
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
            req.skip ??= `Op "extraTurn" mutates a turn-boundary queue, not a same-step outcome — covered by hand-written tests`;
            return;
        case "restrictCasting":
            // CR 601.3a (issue #1057) — a turn-scoped cast lock on a player; the
            // deterministic outcome is the player id (with its optional
            // cardTypes filter, issue #1124) landing in
            // state.cannotCastSpellsThisTurn (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "restrictActivation":
            // CR 602.1 / 605.1a (issue #1124) — a turn-scoped ability-activation
            // lock on a player; the deterministic outcome is the player id
            // landing in state.cannotActivateAbilitiesThisTurn (asserted below).
            analysePlayer(op.player, req, false);
            return;
        case "grantGraveyardPlay":
            // CR 305.1-analog / 601 (issue #1149) — a turn-scoped graveyard
            // play/cast permission grant on a player; the deterministic
            // outcome is the player id (with its zones/maxManaValue) landing
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
                req.skip ??= `object ref "${op.target.ref}" — target depends on a forEach iteration`;
            }
            return;
        case "choice":
            // A `choice` Op suspends resolution for a live player decision
            // (issue #805) — a canned scenario cannot submit picks, so the
            // script is reported as an explicit skip and execution coverage
            // comes from the card's own tests (per the DSL testing regime,
            // choice-carrying cards keep full per-card coverage).
            req.skip ??= `Op "choice" suspends for player input — covered by the card's own suspension/resume tests`;
            return;
        case "discard":
            // `discard` consumes a `choice` Op's picks binding; without the
            // choice's submitted picks the outcome is undefined in a canned
            // scenario — same skip rationale as `choice`.
            req.skip ??= `Op "discard" consumes a choice binding — covered by the card's own suspension/resume tests`;
            return;
        case "grantCastFromExile":
            // `grantCastFromExile` (issue #1156, Dauthi Voidwalker) consumes
            // a `choice(zone: "exile")` Op's picks binding (the exiled card
            // chosen) — without the choice's submitted picks the outcome is
            // undefined in a canned scenario, same skip rationale as
            // `discard`/`sacrifice`.
            req.skip ??= `Op "grantCastFromExile" consumes a choice binding — covered by the card's own suspension/resume tests`;
            return;
        case "reveal":
            // `reveal` (issue #920 / #682) stamps `knownTo` on hidden cards —
            // an information-visibility change, not a battlefield/life/hand-
            // count outcome the canned generator's assertions model. In every
            // shipped card it also precedes a `choice(zoneOwnerId: …)` Op,
            // which already forces a skip on its own — so this case never
            // needs to carry the skip alone in practice, but is explicit for
            // exhaustiveness (a reveal-only script would hit this branch).
            req.skip ??= `Op "reveal" changes card visibility (knownTo) — not a state change the canned generator asserts`;
            return;
        case "mayPay":
            // A `mayPay` Op suspends resolution for a live Pay/Skip decision
            // (issue #806) — a canned scenario cannot submit an answer, so the
            // script is reported as an explicit skip; execution coverage comes
            // from the card's own suspension/resume tests.
            req.skip ??= `Op "mayPay" suspends for a Pay/Skip decision — covered by the card's own suspension/resume tests`;
            return;
        case "scryReorder":
            // A `scryReorder` Op suspends resolution for a live order-top drag
            // decision (issue #885) — a canned scenario cannot submit the
            // ordering, so the script is reported as an explicit skip;
            // execution coverage comes from the Op's own interpreter tests and
            // the migrated cards' suspension/resume tests (per-Op regime).
            req.skip ??= `Op "scryReorder" suspends for a look/reorder-top choice — covered by the Op's interpreter tests and the card's suspension/resume tests`;
            return;
        case "mill":
            // `mill` (issue #885) moves the top N library cards to a graveyard.
            // The canned generator seeds only a minimal filler library and does
            // not model milling a TARGET player's deck, so rather than
            // mis-assert a graveyard delta it reports an explicit skip;
            // execution coverage is the Op's own interpreter tests.
            req.skip ??= `Op "mill" moves top-of-library cards to the graveyard — covered by the Op's interpreter tests`;
            return;
        case "digToHand":
            // A `digToHand` Op suspends resolution for a live look-distribute
            // pick (issue #984) — a canned scenario cannot submit the
            // hand/bottom choice, so the script is reported as an explicit skip;
            // execution coverage comes from the Op's own interpreter tests and
            // the migrated cards' suspension/resume tests (per-Op regime).
            req.skip ??= `Op "digToHand" suspends for a look-distribute pick — covered by the Op's interpreter tests`;
            return;
        case "counter":
            // `counter` targets a SPELL on the stack (issue #806); the canned
            // generator seeds only players and battlefield permanents, not a
            // spell to counter, so it is reported as an explicit skip. Counter
            // execution is proved by the card's own resolution test.
            req.skip ??= `Op "counter" targets a spell on the stack — covered by the card's own resolution test`;
            return;
        case "if":
            // The `if` construct branches on a runtime predicate (issue #806).
            // The taken branch — and thus the observable outcome — depends on
            // a live may-pay outcome or a runtime snapshot the generator does
            // not model, so it is reported as an explicit skip; branch
            // execution is proved by the card's own tests.
            req.skip ??= `construct "if" branches on a runtime predicate — covered by the card's own tests`;
            return;
        case "sacrifice":
            // `sacrifice` (issue #807) consumes a `choice` Op's picks binding
            // — same skip rationale as `discard`.
            req.skip ??= `Op "sacrifice" consumes a choice binding — covered by the card's own suspension/resume tests`;
            return;
        case "moveZone":
            // `moveZone` (issue #839) changes an object's zone. The canned
            // generator only seeds battlefield permanents and player targets —
            // it does not model a graveyard-card target's source zone, and a
            // permanent target it DID seed lives on the opponent's
            // battlefield, whereas the Op's outcome (bounce to hand,
            // reanimate, exile-from-graveyard) depends on which zone the object
            // starts in. Rather than mis-assert, report an explicit skip;
            // execution coverage is the card's own per-card test (the migrated
            // resolve()-cards keep their full behavioural tests).
            req.skip ??= `Op "moveZone" changes zones on an object whose source zone the canned generator does not model — covered by the card's own per-card test`;
            return;
        case "pump":
            // `pump` (issue #840) adds a temporary P/T buff (CR 613.4c). The
            // generator can assert a FIXED-amount pump on an announced
            // permanent slot (it seeds a filler creature there and reads the
            // effective P/T delta after resolution). A `$source` / `$each`
            // target or a `ref`/`count` amount is not modelled — skip and let
            // the card's own per-card test cover it.
            if (!("target" in op.target)) {
                req.skip ??= `Op "pump" targets $source/$each — covered by the card's own per-card test`;
                return;
            }
            if (
                typeof op.power !== "number" ||
                typeof op.toughness !== "number"
            ) {
                req.skip ??= `Op "pump" uses a ref/count P/T amount the canned generator does not model — covered by the card's own per-card test`;
                return;
            }
            recordSlot(req, op.target.target, "permanent");
            return;
        case "counters":
            // `counters` (issue #841) puts/removes counters (CR 122). The
            // generator can assert a FIXED-count ADD on an announced permanent
            // slot (it seeds a filler creature there and reads the counter
            // tally after resolution). A `$source` / `$each` target, a
            // `ref`/`count` amount, or a `remove` (which needs pre-seeded
            // counters the canned generator does not place) is not modelled —
            // skip and let the card's own per-card test cover it.
            if (op.action !== "add") {
                req.skip ??= `Op "counters" removes counters the canned generator does not pre-seed — covered by the card's own per-card test`;
                return;
            }
            if (!("target" in op.target)) {
                req.skip ??= `Op "counters" targets $source/$each — covered by the card's own per-card test`;
                return;
            }
            if (typeof op.count !== "number") {
                req.skip ??= `Op "counters" uses a ref/count amount the canned generator does not model — covered by the card's own per-card test`;
                return;
            }
            recordSlot(req, op.target.target, "permanent");
            return;
        case "tapUntap":
            // `tapUntap` (issue #842) taps/untaps a permanent (CR 701.26). The
            // generator can assert a TAP on an announced permanent slot (it
            // seeds a filler permanent there — untapped by default — and reads
            // its tap state after resolution). An untap (the canned generator
            // seeds untapped permanents, so there is nothing to observe) or a
            // `$source` / `$each` target is not modelled — skip and let the
            // card's own per-card test cover it.
            if (op.action !== "tap") {
                req.skip ??= `Op "tapUntap" untaps a permanent the canned generator already seeds untapped — covered by the card's own per-card test`;
                return;
            }
            if (!("target" in op.target)) {
                req.skip ??= `Op "tapUntap" targets $source/$each — covered by the card's own per-card test`;
                return;
            }
            recordSlot(req, op.target.target, "permanent");
            return;
        case "grantAbility":
            // `grantAbility` (issue #843) grants a keyword static ability to a
            // permanent for a duration (CR 611.1b / 613.1f). The generator can
            // assert a grant on an announced permanent slot (it seeds a filler
            // creature there and reads its `staticAbilities` after resolution).
            // A `$source` / `$each` target is not modelled — skip and let the
            // card's own per-card test cover it.
            if (!("target" in op.target)) {
                req.skip ??= `Op "grantAbility" targets $source/$each — covered by the card's own per-card test`;
                return;
            }
            recordSlot(req, op.target.target, "permanent");
            return;
        case "forEach":
            // The forEach construct (issue #807) iterates a runtime-selected
            // set; the generator cannot predict per-member outcomes (and a
            // body `choice` would suspend for live input). Explicit skip —
            // forEach cards keep their own full per-card tests.
            req.skip ??= `construct "forEach" iterates a runtime-selected set — covered by the card's own tests`;
            return;
        case "delayedTrigger":
            // CR 603.7 (ADR 0048) — the Op schedules a FUTURE trigger whose
            // body fires at a phase boundary the canned scenario never
            // reaches; the only same-resolution outcome is the queued
            // instance. Explicit skip — scheduling, payload capture and
            // fire-time body execution are covered by the Op's own
            // interpreter tests (per-Op regime, issue #838).
            req.skip ??= `Op "delayedTrigger" fires at a future phase boundary — covered by the Op's interpreter tests`;
            return;
        case "libraryLook":
            // CR 701.20 (issue #844) — a shuffle is a seeded-PRNG
            // RANDOMIZATION with no deterministic same-resolution outcome the
            // canned generator can assert (the multiset is preserved but the
            // order is unwitnessed, and knowledge-clearing is not projected).
            // Explicit skip — the shuffle primitive is covered by the Op's own
            // interpreter tests (per-Op regime).
            req.skip ??= `Op "libraryLook" shuffles a library (seeded-PRNG randomization) — covered by the Op's interpreter tests`;
            return;
        case "shuffleSelfIntoLibrary":
            // CR 608.2 / 701.24 (issue #898) — redirects the RESOLVING
            // spell's own destination from graveyard to a shuffled library.
            // Same rationale as `libraryLook`: a shuffle is a seeded-PRNG
            // randomization with no deterministic same-resolution outcome the
            // canned generator can assert (which library slot the card lands
            // in is unwitnessed). Explicit skip — covered by the Op's own
            // interpreter tests (per-Op regime).
            req.skip ??= `Op "shuffleSelfIntoLibrary" shuffles the resolving spell into a library (seeded-PRNG randomization) — covered by the Op's interpreter tests`;
            return;
        case "preventDamage":
            // CR 615 (issue #845) — a prevention shield sits DORMANT until a
            // later damage event tests it; the canned scenario only resolves
            // the spell (it never subsequently deals damage), so the shield's
            // effect has no same-resolution outcome the generator can assert.
            // Explicit skip — shield registration and consumption are covered
            // by the Op's own interpreter tests (per-Op regime).
            req.skip ??= `Op "preventDamage" registers a dormant shield (no same-resolution damage event) — covered by the Op's interpreter tests`;
            return;
        case "regenerate":
            // CR 701.15 (issue #846) — a regeneration shield sits DORMANT until
            // a later destroy event on the permanent consumes it; the canned
            // scenario only resolves the spell (it never subsequently destroys
            // the target), so the shield has no same-resolution outcome the
            // generator can assert. Explicit skip — shield registration and
            // consumption are covered by the Op's own interpreter tests (per-Op
            // regime).
            req.skip ??= `Op "regenerate" registers a dormant regeneration shield (no same-resolution destroy event) — covered by the Op's interpreter tests`;
            return;
        case "createToken":
            // createToken (issue #847) creates token permanents on the
            // controller's battlefield — a deterministic same-resolution
            // outcome the generator asserts directly (it seeds no tokens, so
            // the post-run token count IS the created count). A ref/count
            // `count` (runtime value) or a targeted / ref controller is not
            // modelled — skip and let the card's own per-card test cover it.
            if (op.count !== undefined && typeof op.count !== "number") {
                req.skip ??= `Op "createToken" uses a ref/count token count the canned generator does not model — covered by the card's own per-card test`;
                return;
            }
            if (
                op.controller !== "controller" &&
                op.controller !== "opponent"
            ) {
                req.skip ??= `Op "createToken" controller is a targeted/ref player the canned generator does not model — covered by the card's own per-card test`;
                return;
            }
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
                req.skip ??= `Op "emblem" controller is a targeted/ref player the canned generator does not model — covered by the card's own per-card test`;
                return;
            }
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
            req.skip ??= `Op "gainControl" changes control of a permanent (and installs a conditional-control SBA) — covered by the Op's interpreter tests`;
            return;
        case "optionChoice":
            // CR 700.2 / 601.2b (issue #849) — a modal "choose one" enqueues an
            // `option-pick` Pending Choice and SUSPENDS; which mode runs (and so
            // what outcome to assert) depends on a LIVE player pick the canned
            // generator cannot make. Explicit skip — the mode selection and each
            // branch's execution are covered by the Op's own interpreter tests
            // (per-Op regime). (Mirrors the `choice` / `mayPay` suspending-Op
            // skip.)
            req.skip ??= `Op "optionChoice" suspends on a live mode pick (CR 700.2) — covered by the Op's interpreter tests`;
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
            req.skip ??= `Op "coinFlip" draws a random bit and suspends for the reveal (CR 705) — covered by the Op's interpreter tests`;
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
            req.skip ??= `Op "winGame" sets state.gameOver — covered by the Op's own interpreter test`;
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
            req.skip ??= `Op "divideIntoPiles" suspends for two DIFFERENT players' picks (ADR 0053) — covered by hand-written per-card tests`;
            return;
        case "restrictCombat":
            // CR 508.1a / 509.1b (ADR 0053) — sets a turn-scoped can't-attack/
            // can't-block flag whose only observable effect is at a LATER
            // declare-attackers/declare-blockers step, which the canned
            // single-resolution generator doesn't model (it asserts board/life
            // deltas immediately after resolution, not a later combat step).
            // Explicit skip — covered by the Op's own interpreter test plus
            // Fight or Flight / Stand or Fall's hand-written combat tests.
            req.skip ??= `Op "restrictCombat" only manifests at a later combat step — covered by hand-written tests`;
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
            // `choice` / `scryReorder` / `digToHand` skips).
            req.skip ??= `Op "putBack" suspends for a live hand pick (CR 401.4) — covered by the Op's interpreter tests`;
            return;
        default: {
            // Exhaustiveness guard: a registered Op with no analyser branch is
            // a skip, not a silent pass.
            const _never: never = op;
            void _never;
            req.skip ??= `no scenario analyser for Op "${(op as EffectOp).op}"`;
        }
    }
}

// --- Scenario construction --------------------------------------------------

/** Builds the canned GameState + announced targets satisfying `req`, or a skip
 *  string when a requirement cannot be met. */
function buildScenario(req: Requirements): Scenario | { skip: string } {
    if (req.skip) return { skip: req.skip };

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
                skip: `target slots are not contiguous (missing ${slot})`,
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
        return { skip: "script mixes player and permanent target slots" };
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
        if (spec.zone === "battlefield") {
            (owner === CASTER_ID ? p1Bf : p2Bf).push(...bank);
        } else {
            (owner === CASTER_ID ? p1Gy : p2Gy).push(...bank);
        }
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

/** Reads the fixed size of a count set in the scenario (COUNT_SET_SIZE per
 *  contributing spec — the generator seeds exactly that many). */
function predictAmount(value: EffectValue): number | null {
    if (typeof value === "number") return value;
    if ("ref" in value) return null; // skipped earlier — defensive
    if ("counters" in value) return null; // skipped earlier — defensive
    if ("domain" in value) return null; // skipped earlier — defensive
    return COUNT_SET_SIZE;
}

const OP_ASSERTORS: Record<string, Assertor> = {
    // Damage to a player is an observable life delta; damage to a permanent is
    // marked damage (CR 120.3). The filler creature (toughness 5) survives.
    dealDamage(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "dealDamage" }>;
        const amount = predictAmount(op.amount);
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
    draw(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "draw" }>;
        const count = predictAmount(op.count);
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
    gainLife(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "gainLife" }>;
        const amount = predictAmount(op.amount);
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
    getEnergy(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "getEnergy" }>;
        const amount = predictAmount(op.amount);
        if (amount === null) return null;
        const pid = assertionPlayerId(op.player);
        const before = findPlayer(pre, pid).energyCounters ?? 0;
        const expected = before + amount;
        return {
            label: `getEnergy ${amount} for player ${pid} (energy ${before}→${expected})`,
            check: (post) => {
                const energy = findPlayer(post, pid).energyCounters ?? 0;
                return {
                    ok: energy === expected,
                    detail: `energy ${energy}, expected ${expected}`,
                };
            },
        };
    },
    loseLife(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "loseLife" }>;
        const amount = predictAmount(op.amount);
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
        const before = { ...findPlayer(pre, pid).manaPool };
        const added = Object.entries(op.mana).filter(([, n]) => (n ?? 0) > 0);
        return {
            label: `addMana ${added
                .map(([c, n]) => `${n}${c}`)
                .join("")} to player ${pid}`,
            check: (post) => {
                const pool = findPlayer(post, pid).manaPool;
                for (const [color, amount] of added) {
                    const expected = (before[color] ?? 0) + (amount ?? 0);
                    if ((pool[color] ?? 0) !== expected) {
                        return {
                            ok: false,
                            detail: `${color} pool ${pool[color] ?? 0}, expected ${expected}`,
                        };
                    }
                }
                return { ok: true };
            },
        };
    },
    // Zone change: destroy moves the target to its owner's graveyard
    // (CR 701.8 — the filler is not indestructible).
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
    // `reveal` (issue #920 / #682) — never reached: `analyseOp` skips every
    // script containing it (an information-visibility change, not a state
    // check the canned generator asserts). Kept for the 1:1 coverage guard;
    // execution coverage is the card's own tests.
    reveal() {
        return null;
    },
    // `mayPay` (issue #806) — never reached: `analyseOp` skips every script
    // containing a mayPay Op (a canned scenario cannot answer a live Pay/Skip
    // prompt). The entry keeps the registry ⇄ assertor guard 1:1; execution
    // coverage is the card's own suspension/resume tests.
    mayPay() {
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
    // resolution). `$source`/`$each` targets and `ref`/`count` amounts are
    // skipped upstream in `analyseOp` (returns null defensively here).
    pump(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "pump" }>;
        if (!("target" in op.target)) return null;
        if (typeof op.power !== "number" || typeof op.toughness !== "number") {
            return null;
        }
        const permId = scenario.targetPermanentIds[op.target.target];
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
    // immediately after resolution). `remove`, `$source`/`$each` targets and
    // `ref`/`count` amounts are skipped upstream in `analyseOp` (returns null
    // defensively here).
    counters(rawOp, scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "counters" }>;
        if (op.action !== "add") return null;
        if (!("target" in op.target)) return null;
        if (typeof op.count !== "number") return null;
        const permId = scenario.targetPermanentIds[op.target.target];
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
    // observe) and `$source`/`$each` targets are skipped upstream in
    // `analyseOp` (returns null defensively here).
    tapUntap(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "tapUntap" }>;
        if (op.action !== "tap") return null;
        if (!("target" in op.target)) return null;
        const permId = scenario.targetPermanentIds[op.target.target];
        return {
            label: `tap permanent ${permId} (isTapped false→true)`,
            check: (post) => {
                const perm = post.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === permId);
                if (!perm) {
                    return { ok: false, detail: "target permanent gone" };
                }
                return {
                    ok: perm.isTapped === true,
                    detail: `isTapped ${perm.isTapped}, expected true`,
                };
            },
        };
    },
    // `grantAbility` (issue #843, CR 611.1b / 613.1f) — a grant on an announced
    // permanent slot is observable as the keyword appearing in the target's
    // `staticAbilities` (the primitive appends it, and the grant is active for
    // the rest of the turn so it reads immediately after resolution).
    // `$source`/`$each` targets are skipped upstream in `analyseOp` (returns
    // null defensively here).
    grantAbility(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "grantAbility" }>;
        if (!("target" in op.target)) return null;
        // The activated-ability grant variant (`grantedActivatedId`, issue #738)
        // isn't observable via `staticAbilities`; its cards carry a hand-written
        // per-card test, so skip it here (return null → smoke test skips).
        if (op.ability === undefined) return null;
        const ability = op.ability;
        const permId = scenario.targetPermanentIds[op.target.target];
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
    // `delayedTrigger` (CR 603.7, ADR 0048) — never reached: `analyseOp`
    // skips every script with a delayedTrigger Op (the body fires at a
    // future phase boundary the canned scenario never reaches). Kept for the
    // 1:1 coverage guard; scheduling + fire-time coverage is the Op's own
    // interpreter tests (issue #838).
    delayedTrigger() {
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
    // `digToHand` (CR 401.4, issue #984) — never reached: `analyseOp` skips
    // every script with a digToHand Op (it suspends on a live look-distribute
    // pick, so there is no deterministic same-resolution outcome the canned
    // scenario can assert). Kept for the 1:1 coverage guard; the look / keep /
    // bottom is covered by the Op's own interpreter tests.
    digToHand() {
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
    // `regenerate` (CR 701.15, issue #846) — never reached: `analyseOp` skips
    // every script with a regenerate Op (a shield sits dormant until a later
    // destroy event, with no same-resolution outcome the canned scenario can
    // assert). Kept for the 1:1 coverage guard; shield registration and
    // consumption are covered by the Op's own interpreter tests.
    regenerate() {
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
    // `createToken` (CR 111 / 701.7, issue #847) — a deterministic
    // same-resolution outcome: `count` token permanents matching the spec's
    // types + P/T appear on the controller's battlefield (the canned scenario
    // seeds no tokens). Asserted directly rather than skipped.
    createToken(rawOp, _scenario, pre) {
        const op = rawOp as Extract<EffectOp, { op: "createToken" }>;
        if (op.count !== undefined && typeof op.count !== "number") return null;
        const count = op.count ?? 1;
        const pid = assertionPlayerId(op.controller);
        const matches = (c: CardInstanceState) =>
            c.isToken === true &&
            c.power === op.token.power &&
            c.toughness === op.token.toughness &&
            c.types.length === op.token.types.length &&
            c.types.every((t) => op.token.types.includes(t));
        const before = findPlayer(pre, pid).battlefield.filter(matches).length;
        const expected = before + count;
        return {
            label: `createToken ${count}× ${op.token.types.join("/")} ${op.token.power ?? "-"}/${op.token.toughness ?? "-"} for player ${pid} (${before}→${expected})`,
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
 *  with a reason. Site-agnostic: `effects` may be a spell or an ability script
 *  (the caller supplies the site-appropriate stack item). A script with no
 *  assertable Op (every Op skipped by its assertor — e.g. all amounts are refs)
 *  is reported as a skip so it never counts as passing. */
export function planSmokeTest(effects: readonly EffectOp[]): Plan {
    if (effects.length === 0) {
        return { kind: "skip", reason: "empty effect script" };
    }

    const req: Requirements = {
        targetSlots: new Map(),
        drawingPlayers: new Set(),
        countSets: [],
        skip: null,
    };
    for (const op of effects) analyseOp(op, req);

    const built = buildScenario(req);
    if ("skip" in built) return { kind: "skip", reason: built.skip };

    const assertions: Assertion[] = [];
    for (const op of effects) {
        const assertor = OP_ASSERTORS[op.op];
        if (!assertor) {
            return {
                kind: "skip",
                reason: `Op "${op.op}" has no assertor`,
            };
        }
        const a = assertor(op, built, built.state);
        if (a) assertions.push(a);
    }
    if (assertions.length === 0) {
        return {
            kind: "skip",
            reason: "no assertable outcome — every Op's outcome depends on a runtime ref",
        };
    }
    return { kind: "run", scenario: built, assertions };
}
