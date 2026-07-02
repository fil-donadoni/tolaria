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
    EffectCountSpec,
    EffectOp,
    EffectPlayerRef,
    EffectValue,
    TargetSelection,
} from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";
import { EFFECT_OP_REGISTRY } from "../../cards/mechanicsRegistry";
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
 *  Toughness is high (5) so a smoke-test damage Op leaves observable marked
 *  damage (CR 120.3) instead of killing the creature and moving it out from
 *  under a follow-up assertion. Registered lazily by the sweep harness — the
 *  generator itself only references the id. */
export const FILLER_CARD_ID = "gen-scenario-filler";

/** The stable subtype the filler card carries, so a `count` set filtered by
 *  subtype can be satisfied by spawning filler cards. */
export const FILLER_SUBTYPE = "Bear";

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
    return "ref"; // { ref } — value depends on a runtime snapshot
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
function countFillerId(filter: { type?: string; subtype?: string }): string {
    const type = filter.type ?? "Creature";
    const subtype = filter.subtype ?? FILLER_SUBTYPE;
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
    req.countSets.push(value.count);
    // A count set's own controller may itself be a ref — unmodelable.
    const c = value.count.controller;
    if (typeof c === "object" && "ref" in c) {
        req.skip ??= `count set controller is a ref "${c.ref}"`;
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
            } else {
                recordSlot(req, op.to.target, "permanent");
            }
            return;
        case "draw":
            analysePlayer(op.player, req, true);
            analyseValue(op.count, req);
            return;
        case "gainLife":
        case "loseLife":
            analysePlayer(op.player, req, false);
            analyseValue(op.amount, req);
            return;
        case "destroy":
        case "exile":
            recordSlot(req, op.target.target, "permanent");
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
    // Zone change: destroy moves the target to its owner's graveyard
    // (CR 701.8 — the filler is not indestructible).
    destroy(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "destroy" }>;
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
    // Zone change: exile moves the target to its owner's exile zone (CR 701.13).
    exile(rawOp, scenario) {
        const op = rawOp as Extract<EffectOp, { op: "exile" }>;
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
