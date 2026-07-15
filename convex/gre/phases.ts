import type { Phase } from "./types";
import type {
    CardType,
    GameEvent,
    StaticUntapRestriction,
} from "../cards/types";
import type {
    CardInstanceState,
    DelayedTriggerInstance,
    GameState,
    PlayerState,
} from "./state";
import { MAX_HAND_SIZE, isPlaneswalker } from "./constants";
import {
    removeLoyaltyForDamage,
    applyLifelinkLifeGain,
    applyPlayerDamagePrevention,
    applyTargetPrevention,
    bumpArtifactDamageToPlayer,
    bumpDamageDealtToPlayer,
    markDeathtouchDamage,
    recordSourceDamagedOpponent,
    consumePreventionIfAny,
    destroyWithReplacements,
    drawCard,
    emitCardDrawn,
    flushPendingEvents,
    processPendingActionTriggers,
    getOpponentId,
    getPlayer,
    phaseInUntapCycleBundles,
    isCombatDamageImmune,
    matchesPermanentFilter,
    discardToGraveyard,
    resolveTopOfStack,
    revertControlChange,
    runDamageReplacement,
    tapPermanent,
    untapPermanent,
    tickDuration,
} from "./state";
import { tryGetDefinition } from "../cards";
import { seededShuffle } from "./rng";
import { describeDamageSource } from "./replacements";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "./layers";
import { isProtectedFromSource } from "./protection";
import { isCombatDamagePreventedFromSource } from "./combatDamagePrevention";
import {
    collectTriggers,
    buildDelayedTriggerStackItem,
    placeTriggersOnStack,
} from "./triggers";
import { hasAnyLegalBlock, getRequiredAttackerIds } from "./combat";
import {
    getEffectiveBlockGraph,
    getDamageAssignerId,
    recordBlockedAttackers,
    type BlockGraph,
} from "./banding";

/** Ordered sequence of all phases/steps in a turn. */
const PHASE_ORDER: Phase[] = [
    "UNTAP",
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
    "POSTCOMBAT_MAIN",
    "END_STEP",
    "CLEANUP",
];

/** Which damage step a creature deals damage in (CR 510.2-510.5, 702.7). */
export type DamageKind = "first-strike" | "regular";

function hasFirstOrDoubleStrike(card: CardInstanceState): boolean {
    return (
        card.staticAbilities.includes("first strike") ||
        card.staticAbilities.includes("double strike")
    );
}

/** CR 510.5: A creature deals damage in the first-strike step iff it has
 *  first strike or double strike. It deals damage in the regular step iff
 *  it has no first strike, or it has double strike (which deals twice). */
function dealsDamageIn(card: CardInstanceState, kind: DamageKind): boolean {
    const fs = card.staticAbilities.includes("first strike");
    const ds = card.staticAbilities.includes("double strike");
    if (kind === "first-strike") return fs || ds;
    return !fs || ds;
}

/** CR 510.5: first-strike damage step is skipped if no attacker or blocker
 *  has first strike or double strike when the step would begin. */
function anyCombatantHasFirstOrDoubleStrike(state: GameState): boolean {
    if (!state.combat) return false;
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    for (const id of state.combat.attackerIds) {
        const c = activePlayer.battlefield.find((x) => x.id === id);
        if (c && hasFirstOrDoubleStrike(c)) return true;
    }
    for (const blockerId of Object.keys(state.combat.blockerAssignments)) {
        const c = defender.battlefield.find((x) => x.id === blockerId);
        if (c && hasFirstOrDoubleStrike(c)) return true;
    }
    return false;
}

/** Phases where no player receives priority (automatic). */
const AUTO_PHASES = new Set<Phase>(["UNTAP", "CLEANUP"]);

/** CardDefinition id of Freyalise's Winds (ICE). Its untap replacement keyed on
 *  the `wind` counter (CR 614.6) is active only while the enchantment is on the
 *  battlefield, so the untap-step branch gates on its presence. */
const FREYALISES_WINDS_ID = "b11cd2e0-9419-4267-807e-5b73915c748a";

/** True if any player controls Freyalise's Winds (CR 614 — the wind-counter
 *  untap replacement exists only while the enchantment does). */
function hasFreyalisesWindsInPlay(state: GameState): boolean {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if ((card.card as { id?: string }).id === FREYALISES_WINDS_ID) {
                return true;
            }
        }
    }
    return false;
}

/** Returns the next phase after the given one, or null if end of turn (CLEANUP). */
function nextPhase(current: Phase): Phase | null {
    const idx = PHASE_ORDER.indexOf(current);
    if (idx === -1) throw new Error(`Unknown phase: ${current}`);
    if (idx === PHASE_ORDER.length - 1) return null;
    return PHASE_ORDER[idx + 1];
}

/** Collects every `StaticUntapRestriction` in play (CR 502.1) in a
 *  deterministic walk: active player's battlefield first, then opponent's,
 *  battlefield order within each player. The cursor on
 *  `state.pendingUntapStep` keys into this same order so suspend/resume
 *  across an `untap-pick` prompt resumes exactly where it left off. */
export function collectUntapRestrictions(state: GameState): {
    source: CardInstanceState;
    restriction: StaticUntapRestriction;
}[] {
    const out: {
        source: CardInstanceState;
        restriction: StaticUntapRestriction;
    }[] = [];
    const order: CardInstanceState[] = [];
    const activePlayer = getPlayer(state, state.activePlayerId);
    const opponentId = getOpponentId(state, state.activePlayerId);
    const opponent = getPlayer(state, opponentId);
    order.push(...activePlayer.battlefield, ...opponent.battlefield);
    for (const card of order) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetDefinition(cardId);
        const effects = def?.staticEffects ?? [];
        for (const effect of effects) {
            if (effect.kind === "untap-restriction") {
                // CR 611.2c — a host-scoped restriction (FEM Merseine) gated on
                // the source's live state. Evaluate the condition and resolve
                // the host filter at collection time so the dispatcher sees a
                // plain instance-id filter (or nothing when the gate is closed).
                if (effect.appliesToHost) {
                    const view = effectivePermanentView(state, card);
                    if (effect.condition && !effect.condition(view)) continue;
                    const hostId = card.attachedTo;
                    if (!hostId) continue;
                    out.push({
                        source: card,
                        restriction: {
                            ...effect,
                            filter: { instanceIds: [hostId] },
                        },
                    });
                    continue;
                }
                if (effect.condition) {
                    const view = effectivePermanentView(state, card);
                    if (!effect.condition(view)) continue;
                }
                // CR 502.1 — a restriction whose target set depends on
                // characteristics `PermanentFilter` can't carry (Tsabo's Web:
                // "each land with an activated ability that isn't a mana
                // ability") resolves per-candidate here. Test every permanent
                // that passes the cheap base filter against `dynamicMatch`
                // (which reads the candidate's card definition), then hand the
                // dispatcher a plain instance-id filter — the same shape the
                // `appliesToHost` branch produces.
                if (effect.dynamicMatch) {
                    const ids: string[] = [];
                    for (const candidate of order) {
                        if (
                            !matchesPermanentFilter(
                                effectivePermanentView(state, candidate),
                                effect.filter
                            )
                        ) {
                            continue;
                        }
                        const candidateId = (candidate.card as { id?: string })
                            .id;
                        const candidateDef = candidateId
                            ? tryGetDefinition(candidateId)
                            : undefined;
                        if (!candidateDef) continue;
                        if (
                            !effect.dynamicMatch(
                                effectivePermanentView(state, candidate),
                                candidateDef
                            )
                        ) {
                            continue;
                        }
                        ids.push(candidate.id);
                    }
                    out.push({
                        source: card,
                        restriction: {
                            ...effect,
                            filter: { instanceIds: ids },
                        },
                    });
                    continue;
                }
                out.push({ source: card, restriction: effect });
            }
        }
    }
    return out;
}

/** Returns the list of `PermanentFilter`s from every active hard-skip
 *  restriction (`maxUntap === 0`) in play. Used by the dispatcher to veto
 *  permanents from cap-style restriction eligible sets, and by
 *  `selectResolutionChoice` as a commit-time defense (CR 502.1). */
export function computeHardSkipFilters(state: GameState) {
    return collectUntapRestrictions(state)
        .filter((r) => r.restriction.maxUntap === 0)
        .map((r) => r.restriction.filter);
}

/** Commits an `untap-pick` `PendingChoice` (CR 502.1): untaps the chosen
 *  ids on the chooser's battlefield, pops the choice off the queue, and
 *  resumes the untap dispatcher (`untapStep`). If the dispatcher enqueues
 *  the next restriction's prompt, priority stays with the chooser; if all
 *  restrictions are resolved, `advancePhase` leaves UNTAP and routes
 *  priority to the active player for UPKEEP. */
export function finalizeUntapPick(
    state: GameState,
    selectedIds: string[]
): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (!head || head.kind !== "untap-pick") return;
    const chooser = getPlayer(state, head.zoneOwnerId ?? head.playerId);
    for (const id of selectedIds) {
        const card = chooser.battlefield.find((c) => c.id === id);
        // CR 701.20b — emit "becomes untapped" on the transition (ADR 0028).
        if (card) untapPermanent(state, card);
    }
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
    untapStep(state);
    if ((state.pendingChoices?.length ?? 0) > 0) {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
        return;
    }
    // No more restrictions to resolve — leave UNTAP and continue the
    // normal auto-phase recursion (UNTAP → UPKEEP, granting priority).
    advancePhase(state);
    drainAutoPasses(state);
}

/** Returns a `MatchablePermanent`-shaped view of `card` with its `power` and
 *  `toughness` overridden by the effective values read at call time
 *  (CR 613 layer 7c/7d — counters, +N/+N auras, temporary buffs). The
 *  untap-step dispatcher uses this so power-keyed filters (Meekstone's
 *  `powerAtLeast: 3`) honor the live layer system instead of printed P/T. */
export function effectivePermanentView(
    state: GameState,
    card: CardInstanceState
): CardInstanceState {
    // CR 105 / 202.2 / 613.1d — populate effective colors so color-scoped
    // filters (Magnetic Mountain's "blue creatures") match on the battlefield.
    // `colors` honors layer-5 colorOverride + grantedColors via getColors.
    const colors = STATIC_EFFECT_CTX.getColors(card);
    if (!card.types.includes("Creature")) {
        return { ...card, colors } as CardInstanceState;
    }
    return {
        ...card,
        colors,
        power: getEffectivePower(state, card),
        toughness: getEffectiveToughness(state, card),
    } as CardInstanceState;
}

/** Untap step (CR 502.1, 502.4): the active player declares which
 *  permanents they control will untap, those permanents untap
 *  simultaneously, and every permanent gets per-turn flag cleanup.
 *
 *  Two restriction families compose here:
 *  - **Data-driven `StaticUntapRestriction`** (ADR 0002 factory family,
 *    e.g. Winter Orb, Smoke): the dispatcher walks each restriction in
 *    deterministic order (active player's battlefield first, then
 *    opponent's), computes the active player's eligible set, and either
 *    auto-resolves (per ADR 0003 — `maxUntap === 0` hard skip, or
 *    `eligibles.length === 0` vacuous) or enqueues a `untap-pick`
 *    `PendingChoice` with `count: { min: 0, max: r.maxUntap }`. The cap-
 *    style zero-branch (CR 502.1, 701.39 — "no more than" is a cap, not an
 *    obligation) is the tactical opt-out that keeps the prompt on
 *    single-eligible boards. Multiple restrictions in play fire as
 *    independent prompts in FIFO order — each binds its own filter and
 *    cap, so Winter Orb + Smoke lets the active player untap one land AND
 *    one creature (the filters do not overlap).
 *  - **Per-permanent `does-not-untap`** (Basalt Monolith, Mana Vault,
 *    Paralyze's grant) is an orthogonal axis untouched by the dispatcher
 *    refactor: the marked permanent stays tapped regardless of any other
 *    restriction's outcome.
 *
 *  A `maxUntap: 0` restriction (e.g. Stasis) is a hard skip: matching
 *  permanents cannot untap this step under ANY other cap, and they receive
 *  full cleanup (`manaCommitted` / `isSummoningSick` / `chosenMana` cleared)
 *  exactly as if the untap had succeeded.
 *
 *  Flag cleanup (`manaCommitted`, `isSummoningSick`, `chosenMana`) runs
 *  for every permanent on the active player's battlefield once all
 *  restrictions are processed — including permanents that did not
 *  untap. */
export function untapStep(state: GameState): void {
    const player = getPlayer(state, state.activePlayerId);

    // CR 502.1 / 702.26c,f — the phasing turn-based action happens at the very
    // start of the untap step, BEFORE the active player untaps. Phase in this
    // player's `untap-cycle` bundles now, so a phased-in permanent is on the
    // battlefield in time for the untap (and any untap restrictions) below: if
    // it phased out tapped it untaps here like everything else; if untapped it
    // simply stays. Runs once per untap step (first entry only — a
    // restriction-prompt re-entry must not repeat it). The skip-first-untap
    // guard inside honours CR 702.26f: a permanent phased out THIS turn waits
    // for the controller's NEXT untap step, not the same turn's.
    if ((state.pendingUntapStep?.restrictionCursor ?? 0) === 0) {
        phaseInUntapCycleBundles(state, state.activePlayerId);
    }

    // Data-driven dispatcher loop. `state.pendingUntapStep.restrictionCursor`
    // is set when a prior call enqueued an `untap-pick` prompt; resumption
    // (from `submitResolutionChoice` / `selectResolutionChoice`) re-enters here
    // and continues from where we left off.
    const restrictions = collectUntapRestrictions(state);
    const startCursor = state.pendingUntapStep?.restrictionCursor ?? 0;

    const hardSkipFilters = computeHardSkipFilters(state);

    // First entry only: untap permanents that are NOT subject to any
    // data-driven restriction (so non-land permanents under Winter Orb
    // untap immediately, in parallel with the still-pending land
    // prompt), and clear per-turn flags universally. Restricted
    // permanents stay tapped here; their fate is decided by the matching
    // restriction's prompt (or by the cap auto-resolving in the loop
    // below).
    if (startCursor === 0) {
        const restrictionFilters = restrictions.map(
            (r) => r.restriction.filter
        );

        // CR 502.1 — snapshot which of the active player's permanents were
        // untapped as the untap step begins, BEFORE any untapping happens.
        // Read by upkeep triggers phrased "if ~ started the turn untapped"
        // (Rasputin Dreamweaver, LEG).
        for (const card of player.battlefield) {
            card.startedTurnUntapped = !card.isTapped;
        }

        for (const card of player.battlefield) {
            if (card.staticAbilities.includes("does-not-untap")) {
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                card.tapBonusMana = undefined;
                card.lifePaidThisTap = undefined;
                // CR 502/603.3 — the source untaps (or is fully cleaned up
                // this untap step), so a becomes-tapped trigger from a prior
                // tap is water under the bridge: clear the irreversibility
                // flag so next turn's fresh tap can be undone normally.
                card.tapTriggerCommitted = undefined;
                continue;
            }
            // ATQ cluster E (Phyrexian Gremlins, CR 611.2): a permanent locked
            // by a still-tapped source doesn't untap during its controller's
            // untap step. `checkSourceTappedEffects` (SBA) has already pruned
            // ids whose source left or untapped, so a non-empty array means at
            // least one source still holds the lock. Per-turn cleanup still
            // runs (mirrors the `does-not-untap` branch).
            if (card.untapLockedBy?.length) {
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                card.tapBonusMana = undefined;
                card.lifePaidThisTap = undefined;
                // CR 502/603.3 — the source untaps (or is fully cleaned up
                // this untap step), so a becomes-tapped trigger from a prior
                // tap is water under the bridge: clear the irreversibility
                // flag so next turn's fresh tap can be undone normally.
                card.tapTriggerCommitted = undefined;
                continue;
            }
            // Barl's Cage (DRK, CR 302.6 / 502.1): one-shot "doesn't untap
            // during its controller's next untap step." The flag clears itself
            // here so the FOLLOWING untap step untaps normally. Per-turn
            // commitment cleanup still runs (mirrors the branches above).
            if (card.skipNextUntap) {
                card.skipNextUntap = undefined;
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                card.tapBonusMana = undefined;
                card.lifePaidThisTap = undefined;
                // CR 502/603.3 — the source untaps (or is fully cleaned up
                // this untap step), so a becomes-tapped trigger from a prior
                // tap is water under the bridge: clear the irreversibility
                // flag so next turn's fresh tap can be undone normally.
                card.tapTriggerCommitted = undefined;
                continue;
            }
            // ICE depletion-dual cycle (Land Cap, Lava Tubes, River Delta,
            // Timberline Ridge, Veldt — CR 502.1): "This land doesn't untap
            // during your untap step if it has a depletion counter on it." A
            // conditional, self-clearing untap restriction keyed on the
            // `depletion` counter (CR 122.1): tapping for mana adds one, the
            // upkeep removes one, so the land untaps every other turn. Per-turn
            // commitment cleanup still runs (mirrors the branches above).
            if (
                card.staticAbilities.includes(
                    "does-not-untap-with-depletion-counter"
                ) &&
                (card.counters?.["depletion"] ?? 0) > 0
            ) {
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                card.tapBonusMana = undefined;
                card.lifePaidThisTap = undefined;
                // CR 502/603.3 — the source untaps (or is fully cleaned up
                // this untap step), so a becomes-tapped trigger from a prior
                // tap is water under the bridge: clear the irreversibility
                // flag so next turn's fresh tap can be undone normally.
                card.tapTriggerCommitted = undefined;
                continue;
            }
            // Freyalise's Winds (ICE, CR 614.6 untap replacement keyed on a
            // counter): "If a permanent with a wind counter on it would untap
            // during its controller's untap step, remove all wind counters from
            // it instead." A self-clearing counter-keyed untap replacement — the
            // permanent stays tapped and sheds its wind counters, so it untaps
            // normally the FOLLOWING untap step (unless re-countered by tapping
            // again). Gated on Freyalise's Winds being in play: the replacement
            // exists only while that enchantment does (CR 614 — a replacement
            // effect with no source does nothing), so if no Winds is present the
            // wind counters are inert and the permanent untaps. Per-turn
            // commitment cleanup still runs (mirrors the depletion branch).
            if (
                (card.counters?.["wind"] ?? 0) > 0 &&
                hasFreyalisesWindsInPlay(state)
            ) {
                const next = { ...card.counters };
                delete next["wind"];
                card.counters = Object.keys(next).length > 0 ? next : undefined;
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                card.tapBonusMana = undefined;
                card.lifePaidThisTap = undefined;
                // CR 502/603.3 — the source untaps (or is fully cleaned up
                // this untap step), so a becomes-tapped trigger from a prior
                // tap is water under the bridge: clear the irreversibility
                // flag so next turn's fresh tap can be undone normally.
                card.tapTriggerCommitted = undefined;
                continue;
            }
            // ATQ cluster E (Ashnod's Battle Gear, Tawnos's Weaponry, Phyrexian
            // Gremlins, CR 502.1): "you may choose not to untap this" — defer
            // this permanent to the optional-untap pass after the data-driven
            // restrictions resolve. It stays tapped here; the player picks.
            if (
                card.isTapped &&
                card.staticAbilities.includes("may-choose-not-to-untap")
            ) {
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                card.tapBonusMana = undefined;
                card.lifePaidThisTap = undefined;
                // CR 502/603.3 — the source untaps (or is fully cleaned up
                // this untap step), so a becomes-tapped trigger from a prior
                // tap is water under the bridge: clear the irreversibility
                // flag so next turn's fresh tap can be undone normally.
                card.tapTriggerCommitted = undefined;
                continue;
            }
            const view = effectivePermanentView(state, card);
            if (hardSkipFilters.some((f) => matchesPermanentFilter(view, f))) {
                // Stasis-style hard skip (CR 502.1) — permanent cannot
                // untap this step. Full cleanup runs as if the untap had
                // happened, so the next priority window doesn't misread
                // stale commitment flags.
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                card.tapBonusMana = undefined;
                card.lifePaidThisTap = undefined;
                // CR 502/603.3 — the source untaps (or is fully cleaned up
                // this untap step), so a becomes-tapped trigger from a prior
                // tap is water under the bridge: clear the irreversibility
                // flag so next turn's fresh tap can be undone normally.
                card.tapTriggerCommitted = undefined;
                continue;
            }
            if (
                card.isTapped &&
                restrictionFilters.some((f) => matchesPermanentFilter(view, f))
            ) {
                // Subject to a data-driven cap — defer untap to the
                // restriction's prompt (or to the cap's auto-resolve in
                // the loop below). Per-turn flag cleanup still runs
                // unconditionally on the active BF (CR 502.1, mirrors the
                // `does-not-untap` branch above).
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                card.tapBonusMana = undefined;
                card.lifePaidThisTap = undefined;
                // CR 502/603.3 — the source untaps (or is fully cleaned up
                // this untap step), so a becomes-tapped trigger from a prior
                // tap is water under the bridge: clear the irreversibility
                // flag so next turn's fresh tap can be undone normally.
                card.tapTriggerCommitted = undefined;
                continue;
            }
            // CR 701.20b — emit "becomes untapped" on the transition so
            // untap-watching triggers fire (Tawnos's Coffin, ADR 0028). The
            // events are collected into triggers at step completion below.
            untapPermanent(state, card);
            card.manaCommitted = undefined;
            card.isSummoningSick = undefined;
            card.chosenMana = undefined;
            card.tapBonusMana = undefined;
            card.lifePaidThisTap = undefined;
            // CR 502/603.3 — the source untapped, so a becomes-tapped trigger
            // from a prior tap is water under the bridge: clear the
            // irreversibility flag so next turn's fresh tap undoes normally.
            card.tapTriggerCommitted = undefined;
        }
    }

    for (let i = startCursor; i < restrictions.length; i++) {
        const r = restrictions[i].restriction;
        const eligibles = player.battlefield.filter(
            (c) =>
                c.isTapped &&
                !c.staticAbilities.includes("does-not-untap") &&
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    r.filter
                ) &&
                !hardSkipFilters.some((f) =>
                    matchesPermanentFilter(effectivePermanentView(state, c), f)
                )
        );

        // ADR 0003 auto-resolve cases:
        // - `maxUntap === 0`: hard skip (Stasis-style) — no eligibles can
        //   untap and there is no tactical zero-branch to offer.
        // - `eligibles.length === 0`: nothing to pick, restriction is
        //   vacuous on this board.
        // Otherwise (cap binds with ≥1 eligible): keep the prompt so the
        // active player may declare "untap zero" (CR 502.1 / 701.39 — the
        // cap is permissive, not mandatory).
        if (r.maxUntap === 0 || eligibles.length === 0) {
            continue;
        }

        state.pendingChoices = state.pendingChoices ?? [];
        state.pendingChoices.push({
            stackItemId: "",
            step: 0,
            choiceId: `untap-${i}-${r.id}`,
            playerId: state.activePlayerId,
            zoneOwnerId: state.activePlayerId,
            kind: "untap-pick",
            zone: "battlefield",
            filter: {
                ...r.filter,
                excludeInstanceIds:
                    hardSkipFilters.length > 0
                        ? player.battlefield
                              .filter((c) =>
                                  hardSkipFilters.some((f) =>
                                      matchesPermanentFilter(
                                          effectivePermanentView(state, c),
                                          f
                                      )
                                  )
                              )
                              .map((c) => c.id)
                        : undefined,
            },
            count: { min: 0, max: r.maxUntap },

            prompt: r.oracleText,
        });
        state.pendingUntapStep = {
            restrictionCursor: i + 1,
            optionalCursor: state.pendingUntapStep?.optionalCursor,
        };
        state.priorityPlayerId = state.activePlayerId;
        return;
    }

    // Optional-untap pass (CR 502.1; ATQ cluster E "you may choose not to
    // untap this"). Runs once all data-driven restrictions are resolved. Each
    // `may-choose-not-to-untap` permanent that is still tapped gets its own
    // `untap-pick` prompt (count 0..1) in battlefield order; the cursor on
    // `pendingUntapStep.optionalCursor` resumes the walk after each commit.
    // This is a genuine tactical choice (keep a buff / tap-lock alive vs free
    // the source), so the prompt is never auto-resolved (ADR 0003).
    const optionals = player.battlefield.filter(
        (c) =>
            c.isTapped &&
            c.staticAbilities.includes("may-choose-not-to-untap") &&
            !c.staticAbilities.includes("does-not-untap") &&
            !c.untapLockedBy?.length
    );
    const optionalStart = state.pendingUntapStep?.optionalCursor ?? 0;
    for (let j = optionalStart; j < optionals.length; j++) {
        const card = optionals[j];
        state.pendingChoices = state.pendingChoices ?? [];
        state.pendingChoices.push({
            stackItemId: "",
            step: 0,
            choiceId: `untap-optional-${card.id}`,
            playerId: state.activePlayerId,
            zoneOwnerId: state.activePlayerId,
            kind: "untap-pick",
            zone: "battlefield",
            filter: { instanceIds: [card.id] },
            count: { min: 0, max: 1 },
            prompt: "You may choose not to untap this during your untap step.",
        });
        state.pendingUntapStep = {
            restrictionCursor: restrictions.length,
            optionalCursor: j + 1,
        };
        state.priorityPlayerId = state.activePlayerId;
        return;
    }

    state.pendingUntapStep = undefined;

    // CR 603.3 / ADR 0028 — UNTAP is an auto-phase and grants no priority, so
    // its PERMANENT_UNTAPPED events are never drained by a resolveTopOfStack
    // pass (unlike untap effects during a spell's resolution). Collect the
    // "becomes untapped" triggers (Tawnos's Coffin's return) now and push them;
    // they sit on the stack until the upkeep priority window. Non-untap events
    // (none expected during untap) are left in the queue.
    const pending = state.pendingEvents ?? [];
    const untapEvents = pending.filter((e) => e.type === "PERMANENT_UNTAPPED");
    if (untapEvents.length > 0) {
        const rest = pending.filter((e) => e.type !== "PERMANENT_UNTAPPED");
        state.pendingEvents = rest.length > 0 ? rest : undefined;
        // CR 603.3b (ADR 0058) — order same-controller simultaneous triggers.
        // UNTAP grants no priority: on LANDED the triggers just sit until the
        // upkeep window (helper leaves priority untouched); on the rare SUSPENDED
        // path the helper parks priority on the chooser.
        placeTriggersOnStack(state, collectTriggers(state, untapEvents));
    }
}

/** Draw step: active player draws a card. Skipped on turn 1 (CR 103.8).
 *
 *  CR 614 — Aladdin's Lamp: if the active player has an armed draw-look
 *  replacement, the natural draw is replaced. The step consumes the first
 *  matching entry and suspends on a `draw-look-keep` `PendingChoice`
 *  (mirroring the untap step's phase-level prompt); `finalizeDrawLookKeep`
 *  reorders the library and performs the actual draw on commit. */
function drawStep(state: GameState): void {
    if (state.turn === 1) return;
    if (hasDrawSkipReplacement(state, state.activePlayerId)) return;

    const armed = state.drawLookReplacements ?? [];
    const idx = armed.findIndex((r) => r.playerId === state.activePlayerId);
    const player = getPlayer(state, state.activePlayerId);
    if (idx !== -1) {
        const repl = armed[idx];
        // One-shot: consume the replacement now whether or not it finds cards.
        const remaining = [...armed.slice(0, idx), ...armed.slice(idx + 1)];
        state.drawLookReplacements =
            remaining.length > 0 ? remaining : undefined;

        const x = Math.min(repl.x, player.library.length);
        if (x <= 0) {
            // No cards to look at — the replacement does nothing beyond the
            // normal draw (which itself flags hasDrawnFromEmpty if empty).
            if (drawCard(player) !== null) emitCardDrawn(state, player.id, 1);
            return;
        }
        const topIds = player.library.slice(0, x).map((c) => c.id);
        state.pendingChoices = state.pendingChoices ?? [];
        state.pendingChoices.push({
            stackItemId: "",
            step: 0,
            choiceId: `draw-look-${state.activePlayerId}`,
            playerId: state.activePlayerId,
            zoneOwnerId: state.activePlayerId,
            kind: "draw-look-keep",
            zone: "library",
            candidateIds: topIds,
            count: 1,
            prompt: `Look at the top ${x} card${x === 1 ? "" : "s"} of your library. Keep one to draw; put the rest on the bottom in a random order.`,
        });
        state.priorityPlayerId = state.activePlayerId;
        return;
    }

    // CR 504.1 — the turn-based draw for the draw step. Emit CARD_DRAWN so
    // "when you draw a card" triggers (Fasting) fire; the DRAW phase entry
    // drains pending events right after `drawStep` returns.
    if (drawCard(player) !== null) emitCardDrawn(state, player.id, 1);
}

/** Commits a `draw-look-keep` `PendingChoice` (CR 614 — Aladdin's Lamp): the
 *  kept card stays on top, the other looked-at cards go to the bottom of the
 *  library in a random order (seeded PRNG, so replays are deterministic), then
 *  the active player draws the kept card. Resumes the normal draw-step priority
 *  window afterwards (the draw step itself is not yet over — CR 504.2). */
export function finalizeDrawLookKeep(
    state: GameState,
    selectedIds: string[]
): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (!head || head.kind !== "draw-look-keep") return;
    const player = getPlayer(state, head.zoneOwnerId ?? head.playerId);
    const candidateIds = head.candidateIds ?? [];
    const keptId = selectedIds[0];

    const lookedSet = new Set(candidateIds);
    const kept = player.library.find((c) => c.id === keptId);
    // CR — "put all but one on the bottom in a random order".
    const rest = player.library.filter(
        (c) => lookedSet.has(c.id) && c.id !== keptId
    );
    seededShuffle(state, rest);
    const below = player.library.filter((c) => !lookedSet.has(c.id));
    player.library = [...(kept ? [kept] : []), ...below, ...rest];

    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;

    // CR — "then draw a card" (the kept card is now on top).
    if (drawCard(player) !== null) emitCardDrawn(state, player.id, 1);
    processPendingActionTriggers(state);

    if ((state.pendingChoices?.length ?? 0) > 0) {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
        return;
    }
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    drainAutoPasses(state);
}

function hasDrawSkipReplacement(state: GameState, playerId: string): boolean {
    const player = getPlayer(state, playerId);
    for (const card of player.battlefield) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetDefinition(cardId);
        if (def?.drawStepReplacement) return true;
    }
    return false;
}

/** attackerId → blocker ids, band-expanded (CR 702.21e): a blocker assigned to
 *  any band member blocks every member. Reduces to a plain inversion of
 *  blockerAssignments when no bands are declared. */
function getBlockersPerAttacker(state: GameState): Record<string, string[]> {
    return getEffectiveBlockGraph(state).blockersByAttacker;
}

function getCardPower(state: GameState, card: CardInstanceState): number {
    return Math.max(0, getEffectivePower(state, card));
}

function getCardToughness(state: GameState, card: CardInstanceState): number {
    return getEffectiveToughness(state, card);
}

/** Looks up a creature on either battlefield by instance id. */
function findCreature(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    for (const player of state.players) {
        const found = player.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    return undefined;
}

/** A combat-damage source needs a manual assignment choice when it deals
 *  damage this step and has 2+ targets to split among (CR 510.1c/d). For an
 *  attacker that means 2+ blockers; for a blocker (only possible under banding)
 *  that means it blocks 2+ band members. Returns the set of such source ids. */
function getManualAssignmentSourceIds(
    state: GameState,
    kind: DamageKind,
    graph: BlockGraph
): string[] {
    const ids: string[] = [];
    const dealsAndHasPower = (c: CardInstanceState | undefined): boolean =>
        !!c && dealsDamageIn(c, kind) && getCardPower(state, c) > 0;
    for (const [attackerId, blockerIds] of Object.entries(
        graph.blockersByAttacker
    )) {
        if (blockerIds.length < 2) continue;
        if (dealsAndHasPower(findCreature(state, attackerId)))
            ids.push(attackerId);
    }
    for (const [blockerId, attackerIds] of Object.entries(
        graph.attackersByBlocker
    )) {
        if (attackerIds.length < 2) continue;
        if (dealsAndHasPower(findCreature(state, blockerId)))
            ids.push(blockerId);
    }
    return ids;
}

/** CR 508.1a / 702.19e (issue #1220) — the id that a trampling attacker's
 *  excess-over-blockers damage is assigned to: the planeswalker it declared as
 *  its attack target (if that planeswalker is still on the battlefield), else
 *  the defending player. Used to seed the auto/default damage assignments so a
 *  blocked trampler attacking a planeswalker spills its excess onto the
 *  planeswalker's loyalty rather than the player. */
function attackTargetExcessSink(
    state: GameState,
    attackerId: string,
    defenderId: string,
    defender: PlayerState
): string {
    const pwId = state.combat?.attackTargets?.[attackerId];
    if (
        pwId &&
        defender.battlefield.some((c) => c.id === pwId && isPlaneswalker(c))
    ) {
        return pwId;
    }
    return defenderId;
}

/** Build auto damage assignments for attackers with 0 or 1 blocker. */
export function buildAutoDamageAssignments(
    state: GameState,
    kind: DamageKind
): Record<string, Record<string, number>> {
    const blockersPerAttacker = getBlockersPerAttacker(state);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const result: Record<string, Record<string, number>> = {};

    for (const attackerId of state.combat!.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        if (!dealsDamageIn(attacker, kind)) continue;
        const blockers = blockersPerAttacker[attackerId] ?? [];
        const hasTrample = attacker.staticAbilities.includes("trample");
        // CR 508.1a / 702.19e (issue #1220) — trample excess over blockers goes
        // to the thing the attacker is attacking. If that is a planeswalker (and
        // it is still on the battlefield), the excess removes its loyalty; else
        // it hits the defending player.
        const excessSink = attackTargetExcessSink(
            state,
            attackerId,
            defenderId,
            defender
        );

        if (blockers.length === 1) {
            const blocker = defender.battlefield.find(
                (c) => c.id === blockers[0]
            );
            if (hasTrample && blocker) {
                // Trample: assign lethal damage to blocker, excess to defender
                const lethal = getCardToughness(state, blocker);
                const toBlocker = Math.min(
                    getCardPower(state, attacker),
                    lethal
                );
                const toDefender = getCardPower(state, attacker) - toBlocker;
                const assignment: Record<string, number> = {
                    [blockers[0]]: toBlocker,
                };
                if (toDefender > 0) {
                    assignment[excessSink] = toDefender;
                }
                result[attackerId] = assignment;
            } else {
                result[attackerId] = {
                    [blockers[0]]: getCardPower(state, attacker),
                };
            }
        }
        // 0 blockers = unblocked, handled separately in applyAllCombatDamage
    }
    return result;
}

/** Build default damage assignments for multi-blocker attackers.
 *  With trample, assigns lethal to each blocker in declaration order, excess
 *  to defender. CR 510.1c/d let the attacker freely re-divide damage in the
 *  damage-assignment modal — this just seeds a sensible default. */
function buildDefaultDamageAssignments(
    state: GameState,
    kind: DamageKind
): Record<string, Record<string, number>> {
    const blockersPerAttacker = getBlockersPerAttacker(state);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const result: Record<string, Record<string, number>> = {};

    for (const attackerId of state.combat!.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        if (!dealsDamageIn(attacker, kind)) continue;
        const blockers = blockersPerAttacker[attackerId] ?? [];
        const hasTrample = attacker.staticAbilities.includes("trample");
        // CR 508.1a / 702.19e (issue #1220) — trample excess sink: the attacked
        // planeswalker (if alive) else the defending player.
        const excessSink = attackTargetExcessSink(
            state,
            attackerId,
            defenderId,
            defender
        );

        if (blockers.length === 1) {
            if (hasTrample) {
                const blocker = defender.battlefield.find(
                    (c) => c.id === blockers[0]
                );
                const lethal = blocker ? getCardToughness(state, blocker) : 0;
                const toBlocker = Math.min(
                    getCardPower(state, attacker),
                    lethal
                );
                const toDefender = getCardPower(state, attacker) - toBlocker;
                const assignment: Record<string, number> = {
                    [blockers[0]]: toBlocker,
                };
                if (toDefender > 0) assignment[excessSink] = toDefender;
                result[attackerId] = assignment;
            } else {
                result[attackerId] = {
                    [blockers[0]]: getCardPower(state, attacker),
                };
            }
        } else if (blockers.length >= 2) {
            const assignment: Record<string, number> = {};
            if (hasTrample) {
                // Default with trample: lethal to each in order, excess to defender
                let remaining = getCardPower(state, attacker);
                for (const blockerId of blockers) {
                    const blocker = defender.battlefield.find(
                        (c) => c.id === blockerId
                    );
                    const lethal = blocker
                        ? getCardToughness(state, blocker)
                        : 0;
                    const toThis = Math.min(remaining, lethal);
                    assignment[blockerId] = toThis;
                    remaining -= toThis;
                }
                if (remaining > 0) assignment[excessSink] = remaining;
            } else {
                // Default without trample: all damage to first blocker
                for (let i = 0; i < blockers.length; i++) {
                    assignment[blockers[i]] =
                        i === 0 ? getCardPower(state, attacker) : 0;
                }
            }
            result[attackerId] = assignment;
        }
    }

    // Blocker sources with 2+ targets exist only under banding (CR 702.21e): a
    // blocker blocking a band. Seed all of its power onto the first band member
    // — the assigning player (the attacker, CR 702.21k) redivides in the modal.
    const { attackersByBlocker } = getEffectiveBlockGraph(state);
    for (const [blockerId, attackerIds] of Object.entries(attackersByBlocker)) {
        if (attackerIds.length < 2) continue;
        const blocker = findCreature(state, blockerId);
        if (!blocker || !dealsDamageIn(blocker, kind)) continue;
        const power = getCardPower(state, blocker);
        const assignment: Record<string, number> = {};
        attackerIds.forEach((id, i) => {
            assignment[id] = i === 0 ? power : 0;
        });
        result[blockerId] = assignment;
    }
    return result;
}

/**
 * Apply combat damage for a single damage step and move dead creatures to
 * the graveyard. When `kind` is "first-strike" only creatures with first
 * strike or double strike deal damage (CR 510.2). When "regular", creatures
 * without first strike deal damage; creatures with double strike deal again
 * (CR 510.5).
 *
 * @param damageAssignments attackerId → { blockerId|defenderId: damage } — used
 *   only for multi-blocker attackers currently dealing damage in this step.
 */
export function applyAllCombatDamage(
    state: GameState,
    damageAssignments: Record<string, Record<string, number>>,
    kind: DamageKind = "regular"
): void {
    if (!state.combat) return;
    if (state.preventAllCombatDamageThisTurn) return;

    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    // Band-expanded block graph (CR 702.21e): a blocker assigned to one band
    // member blocks the whole band, and every member is blocked.
    const { blockersByAttacker, attackersByBlocker } =
        getEffectiveBlockGraph(state);

    // Track damage received: cardId → total damage
    const damageReceived: Record<string, number> = {};
    const events: GameEvent[] = [];

    // Helper: apply one combat damage event from `source` through the full
    // CR 614 → CR 615 → CR 702.16 → application pipeline. `target` and
    // `amount` may be rewritten by replacement effects (Simulacrum, Veteran
    // Bodyguard, Personal Incarnation redirect damage to themselves; Jade
    // Monolith activates redirect to controller). Permanent damage is
    // accumulated into `damageReceived` for the post-loop lethal scan.
    function applyOneCombatDamage(
        source: CardInstanceState,
        rawTarget: { type: "player" | "permanent"; id: string },
        rawAmount: number
    ): void {
        if (rawAmount <= 0) return;
        // CR 510.1c — "assigns no combat damage this turn" (Farrel's Mantle,
        // Farrel's Zealot): the source assigns 0 combat damage, so it deals
        // none in any damage step this turn. Source-only (the creature can
        // still BE dealt combat damage). Checked before the replacement
        // pipeline since no damage event is generated at all.
        if (state.assignsNoCombatDamageThisTurn?.includes(source.id)) return;
        // CR 615 — Ebony Horse: prevent all combat damage to and by the
        // shielded creature. Block both directions before the replacement
        // pipeline (the damage simply never happens).
        if (isCombatDamageImmune(state, source.id)) return;
        if (
            rawTarget.type === "permanent" &&
            isCombatDamageImmune(state, rawTarget.id)
        ) {
            return;
        }
        const repl = runDamageReplacement(
            state,
            source.id,
            source.controllerId,
            rawTarget,
            rawAmount,
            true
        );
        if (!repl) return;
        const finalTarget = repl.target;
        const finalAmount = repl.amount;
        if (finalAmount <= 0) return;
        if (finalTarget.type === "player") {
            if (consumePreventionIfAny(state, source.id, finalTarget.id))
                return;
            const desc = describeDamageSource(state, source.id);
            // CR 615.1: per-player source-matched shields (Dark Sphere /
            // Scarecrow). Scarecrow's "by creatures with flying" reads the
            // attacker's keywords off the damage source description.
            let reduced = applyPlayerDamagePrevention(
                state,
                finalTarget.id,
                source.id,
                desc.staticAbilities,
                finalAmount
            );
            if (reduced <= 0) return;
            reduced = applyTargetPrevention(
                state,
                "player",
                finalTarget.id,
                reduced
            );
            if (reduced <= 0) return;
            getPlayer(state, finalTarget.id).life -= reduced;
            // CR 119.3 — combat damage to a player causes life loss. Pushed
            // onto the same `events` batch that feeds `collectTriggers` below
            // so "whenever you lose life" triggers (Oath of Lim-Dûl) fire from
            // combat damage too.
            events.push({
                type: "LIFE_LOST",
                playerId: finalTarget.id,
                amount: reduced,
                fromDamage: true,
            });
            bumpDamageDealtToPlayer(state, finalTarget.id, reduced);
            // CR 120.3 — flag the source if it hit an opponent (Whirling
            // Dervish's end-step growth condition).
            recordSourceDamagedOpponent(state, source.id, finalTarget.id);
            // CR 120.3 (artifact-narrowed) — Reverse Polarity tally.
            bumpArtifactDamageToPlayer(
                state,
                finalTarget.id,
                reduced,
                desc.types
            );
            events.push({
                type: "DAMAGE_DEALT",
                sourceInstanceId: source.id,
                sourceControllerId: source.controllerId,
                target: { type: "player", id: finalTarget.id },
                amount: reduced,
                isCombat: true,
                sourceColors: desc.colors,
                sourceTypes: desc.types,
                sourceSubtypes: desc.subtypes,
                sourceStaticAbilities: desc.staticAbilities,
            });
            // CR 702.15b — lifelink: combat damage dealt to a player also gains
            // the source's controller that much life, simultaneously with the
            // damage (CR 119.3). Emitted into `pendingEvents`, which is flushed
            // into this step's `events` batch before `collectTriggers` so a
            // "whenever you gain life" trigger fires from combat lifelink too.
            applyLifelinkLifeGain(
                state,
                source.controllerId,
                desc.staticAbilities,
                reduced
            );
        } else if (finalTarget.type === "permanent") {
            const targetCard =
                activePlayer.battlefield.find((c) => c.id === finalTarget.id) ??
                defender.battlefield.find((c) => c.id === finalTarget.id);
            if (!targetCard) return;
            if (isProtectedFromSource(targetCard, source)) return;
            // CR 615 / 611 — continuous source-filtered combat-damage
            // prevention (Enchanted Being, Wall of Vapor). Re-evaluated live
            // each combat: prevents all combat damage from a matching source.
            if (isCombatDamagePreventedFromSource(state, targetCard, source))
                return;
            const reduced = applyTargetPrevention(
                state,
                "permanent",
                finalTarget.id,
                finalAmount
            );
            if (reduced <= 0) return;
            // CR 120.3c / 704.5i (issue #1220) — combat damage dealt to a
            // planeswalker removes that many loyalty counters instead of being
            // marked against toughness (a planeswalker has none). Route it
            // through the shared loyalty-removal path (#700); the 0-loyalty
            // death is the separate `checkZeroLoyaltySBA`, so a planeswalker is
            // deliberately kept OUT of the `damageReceived` toughness lethal
            // scan below.
            const targetIsPlaneswalker = isPlaneswalker(targetCard);
            if (targetIsPlaneswalker) {
                removeLoyaltyForDamage(targetCard, reduced);
            } else {
                damageReceived[finalTarget.id] =
                    (damageReceived[finalTarget.id] ?? 0) + reduced;
            }
            const desc = describeDamageSource(state, source.id);
            events.push({
                type: "DAMAGE_DEALT",
                sourceInstanceId: source.id,
                sourceControllerId: source.controllerId,
                target: { type: "permanent", id: finalTarget.id },
                amount: reduced,
                isCombat: true,
                sourceColors: desc.colors,
                sourceTypes: desc.types,
                sourceSubtypes: desc.subtypes,
                sourceStaticAbilities: desc.staticAbilities,
            });
            // CR 702.15b — lifelink: combat damage dealt to a blocking/attacking
            // creature or planeswalker gains the source's controller that much
            // life (CR 119.3).
            applyLifelinkLifeGain(
                state,
                source.controllerId,
                desc.staticAbilities,
                reduced
            );
            // CR 702.2b — deathtouch: any nonzero combat damage from a
            // deathtouch source marks the creature for destruction as an SBA
            // (CR 704.5h). Folded into this step's lethal scan below so the
            // deathtouch death is simultaneous with normal combat deaths.
            // Meaningless against a planeswalker (no toughness / CR 704.5h), so
            // it is skipped there.
            if (!targetIsPlaneswalker) {
                markDeathtouchDamage(targetCard, desc.staticAbilities, reduced);
            }
            // CR 603.7 / 119 — Glyph of Life: if a turn-scoped lifegain effect
            // watches this permanent and the damage source is an ATTACKER
            // (CR 506.2 — its id is in the active combat's attacker list), the
            // effect's controller gains that much life. Damage from a blocker
            // or a non-combat source never reaches here as an attacker.
            const watchers = state.damageTriggeredLifegain;
            if (
                watchers?.length &&
                state.combat?.attackerIds.includes(source.id)
            ) {
                for (const w of watchers) {
                    if (w.instanceId !== finalTarget.id) continue;
                    getPlayer(state, w.controllerId).life += reduced;
                }
            }
        }
    }

    // --- Attacker damage (CR 510). Unblocked attackers hit the defender;
    // blocked attackers (including band members blocked only by association)
    // deal per their assignment among blockers / the defender on trample. ---
    for (const attackerId of state.combat.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue; // removed before damage (e.g. killed by instant)
        if (!dealsDamageIn(attacker, kind)) continue;

        // Only blockers still on the battlefield deal/absorb damage. A dead
        // blocker can linger in `blockerAssignments` (removal doesn't prune it)
        // — count just the live ones for the blocked-vs-trample-through branch.
        const liveBlockers = (blockersByAttacker[attackerId] ?? []).filter(
            (id) => findCreature(state, id) !== undefined
        );
        const attackerPower = getCardPower(state, attacker);
        // CR 509.1h — "blocked" is combat state, not the live blocker count: an
        // attacker is blocked if it has a blocker now OR it became blocked this
        // combat (recorded at declare-blockers and survives losing every
        // blocker). Only a never-blocked attacker hits the defender freely.
        const becameBlocked =
            state.combat.blockedAttackerIds?.includes(attackerId) ?? false;
        const isBlocked = liveBlockers.length > 0 || becameBlocked;
        const hasTrample = attacker.staticAbilities.includes("trample");

        // CR 508.1a (issue #1220) — the planeswalker this attacker declared as
        // its attack target, if any and if still on the defending player's
        // battlefield. Absence (or a planeswalker that has since left) means the
        // attacker is attacking the defending player.
        const pwTargetId = state.combat.attackTargets?.[attackerId];
        const pwTargetCard = pwTargetId
            ? defender.battlefield.find(
                  (c) => c.id === pwTargetId && isPlaneswalker(c)
              )
            : undefined;

        // CR 509.1h / 508.4 (issue #1220) — an attacker that declared a
        // planeswalker assigns ALL of its combat damage to that planeswalker
        // (removing loyalty via the shared #700 path). Regular `trample` does
        // NOT carry excess over to the defending player: "trample over
        // planeswalkers" (CR 702.19f) is a distinct keyword ability that no
        // in-scope card has, so damage beyond the planeswalker's loyalty is
        // simply wasted — there is no planeswalker→controller spill path.
        function dealToAttackedPlaneswalker(
            src: CardInstanceState,
            pwId: string,
            amount: number
        ): void {
            if (amount <= 0) return;
            applyOneCombatDamage(src, { type: "permanent", id: pwId }, amount);
        }

        if (!isBlocked) {
            if (attackerPower > 0) {
                if (pwTargetId) {
                    // CR 508.1a / 509.1h (issue #1220) — this attacker declared
                    // a planeswalker as its target: ALL its combat damage
                    // removes that planeswalker's loyalty. Regular trample does
                    // NOT spill excess to the controlling player (CR 702.19f —
                    // "trample over planeswalkers" is a distinct, out-of-scope
                    // keyword). The Kjeldoran / Forcefield shields below are
                    // defending-player-directed and do not apply. If the
                    // planeswalker left the battlefield before damage, there is
                    // nothing to deal to — the damage is NOT redirected to the
                    // player.
                    if (pwTargetCard) {
                        dealToAttackedPlaneswalker(
                            attacker,
                            pwTargetId,
                            attackerPower
                        );
                    }
                    continue;
                }
                // CR 614.6 — Kjeldoran Royal Guard: all combat damage unblocked
                // attackers would deal to the defending player is redirected
                // onto a chosen permanent instead. The redirect target must
                // still be on the battlefield; otherwise the damage hits the
                // player normally (CR 614.6 — a redirection to a nonexistent
                // object does nothing).
                const redirect = state.combatDamageRedirectToPermanent?.find(
                    (e) =>
                        e.playerId === defenderId &&
                        (activePlayer.battlefield.some(
                            (c) => c.id === e.toPermanentId
                        ) ||
                            defender.battlefield.some(
                                (c) => c.id === e.toPermanentId
                            ))
                );
                if (redirect) {
                    applyOneCombatDamage(
                        attacker,
                        { type: "permanent", id: redirect.toPermanentId },
                        attackerPower
                    );
                } else {
                    // CR 615 — Forcefield: cap damage from unblocked creature
                    let damage = attackerPower;
                    const caps = state.damageCapShields;
                    if (caps && caps.length > 0) {
                        const capIdx = caps.findIndex(
                            (s) => s.playerId === defenderId
                        );
                        if (capIdx !== -1) {
                            damage = Math.min(damage, caps[capIdx].maxDamage);
                            state.damageCapShields = [
                                ...caps.slice(0, capIdx),
                                ...caps.slice(capIdx + 1),
                            ];
                            if (state.damageCapShields.length === 0) {
                                state.damageCapShields = undefined;
                            }
                        }
                    }
                    applyOneCombatDamage(
                        attacker,
                        { type: "player", id: defenderId },
                        damage
                    );
                }
            }
        } else if (liveBlockers.length === 0) {
            // CR 510.1c — a blocked creature that lost all its blockers deals
            // no combat damage to the defender unless it has trample, in which
            // case (no blocker left to absorb lethal) it tramples its full
            // power through. Forcefield only caps UNblocked creatures, so it
            // does not apply here.
            if (hasTrample && attackerPower > 0) {
                if (pwTargetId) {
                    // CR 508.1a (issue #1220) — trample-through from a blocked
                    // attacker whose blockers all left assigns ALL its power to
                    // the attacked planeswalker's loyalty; no excess spills to
                    // the controller (CR 702.19f — regular trample does not
                    // carry over a planeswalker).
                    if (pwTargetCard) {
                        dealToAttackedPlaneswalker(
                            attacker,
                            pwTargetId,
                            attackerPower
                        );
                    }
                } else {
                    applyOneCombatDamage(
                        attacker,
                        { type: "player", id: defenderId },
                        attackerPower
                    );
                }
            }
        } else {
            const assignments = damageAssignments[attackerId] ?? {};
            for (const [targetId, damage] of Object.entries(assignments)) {
                if (damage <= 0) continue;
                applyOneCombatDamage(
                    attacker,
                    targetId === defenderId
                        ? { type: "player", id: defenderId }
                        : { type: "permanent", id: targetId },
                    damage
                );
            }
        }
    }

    // --- Blocker damage (CR 510). Each blocker deals once. A blocker blocking
    // a single creature deals its full power to it; a blocker blocking a band
    // (CR 702.21e) splits its power among the members per the assignment the
    // attacking player chose (CR 702.21k). ---
    for (const [blockerId, blockedAttackerIds] of Object.entries(
        attackersByBlocker
    )) {
        const blocker = defender.battlefield.find((c) => c.id === blockerId);
        if (!blocker) continue;
        if (!dealsDamageIn(blocker, kind)) continue;
        const blockerPower = getCardPower(state, blocker);
        if (blockerPower <= 0) continue;

        if (blockedAttackerIds.length <= 1) {
            const targetId = blockedAttackerIds[0];
            if (targetId) {
                applyOneCombatDamage(
                    blocker,
                    { type: "permanent", id: targetId },
                    blockerPower
                );
            }
        } else {
            const assignments = damageAssignments[blockerId] ?? {};
            for (const [targetId, damage] of Object.entries(assignments)) {
                if (damage <= 0) continue;
                applyOneCombatDamage(
                    blocker,
                    { type: "permanent", id: targetId },
                    damage
                );
            }
        }
    }

    // CR 120.3: record which sources dealt damage to each victim this turn.
    // Preserved through CLEANUP (CR 514.2) so post-death lookup triggers
    // (Sengir Vampire) can inspect the victim after it leaves the battlefield.
    for (const ev of events) {
        if (ev.type !== "DAMAGE_DEALT") continue;
        if (ev.target.type !== "permanent") continue;
        const hit =
            activePlayer.battlefield.find((c) => c.id === ev.target.id) ??
            defender.battlefield.find((c) => c.id === ev.target.id);
        if (!hit) continue;
        hit.damagedBySources = [
            ...(hit.damagedBySources ?? []),
            ev.sourceInstanceId,
        ];
    }

    // CR 120.3: accumulate combat damage onto the creature's marked damage,
    // then check CR 704.5g lethal against effective toughness (layer 7c).
    const deadIds = new Set<string>();
    for (const [cardId, damage] of Object.entries(damageReceived)) {
        const card =
            activePlayer.battlefield.find((c) => c.id === cardId) ??
            defender.battlefield.find((c) => c.id === cardId);
        if (!card) continue;
        card.damageMarked = (card.damageMarked ?? 0) + damage;
        // CR 704.5g lethal, OR CR 702.2b/704.5h deathtouch: a creature dealt any
        // nonzero damage this step by a deathtouch source is destroyed here too,
        // simultaneously with normal combat deaths (CR 510.4). The SBA is the
        // general mechanism (non-combat damage); folding it in here keeps combat
        // deaths simultaneous. `destroyWithReplacements` respects indestructible.
        if (
            card.damageMarked >= getCardToughness(state, card) ||
            card.dealtDeathtouchDamage === true
        ) {
            deadIds.add(cardId);
        }
    }

    // Move dead creatures to their owner's graveyard. Each victim is routed
    // through regenerateOrDestroy (CR 614.5, 701.15a) so a regen shield can
    // replace the destroy with the heal/tap/leave-combat rider — those
    // creatures stay on the battlefield. Actual deaths emit CREATURE_DIED
    // (CR 700.4) into `state.pendingEvents` from `removePermanentTo`; we
    // drain the queue below so the combat collectTriggers pass sees both
    // DAMAGE_DEALT and CREATURE_DIED in one go.
    for (const cardId of deadIds) {
        const carrier =
            activePlayer.battlefield.find((c) => c.id === cardId) ??
            defender.battlefield.find((c) => c.id === cardId);
        if (!carrier) continue;
        const wasDestroyed = destroyWithReplacements(state, cardId);
        if (!wasDestroyed) continue;
        // The destroyed card has already been moved to its owner's graveyard
        // by removePermanentTo. Reset combat-only flags on the dead instance
        // for parity with the prior implementation.
        carrier.isAttacking = undefined;
        carrier.isBlocking = undefined;
        carrier.isTapped = false;
    }
    // Drain CREATURE_DIED events queued by removePermanentTo so this step's
    // trigger scan sees them alongside DAMAGE_DEALT (CR 603.2).
    events.push(...flushPendingEvents(state));

    // Collect triggered abilities fired by this damage step (CR 603.2). Dead
    // permanents are already gone, so their own triggers are skipped — that's
    // not strictly CR-correct for LTB/"when ~ dies" triggers, but those are
    // out of scope here.
    const triggers = collectTriggers(state, events);
    // CR 603.3b (ADR 0058) — LANDED: active player gets priority again with the
    // triggers on the stack (CR 117.3c). SUSPENDED: the helper parked priority
    // on the ordering chooser.
    if (placeTriggersOnStack(state, triggers)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** Emits a PHASE_BEGIN event for the current phase, collects matching
 *  triggered abilities from all battlefield permanents (CR 603.6a), pushes
 *  them on the stack, and restarts priority at the active player (CR 117.3c).
 *  No-op when the scan yields no triggers. Intervening-if conditions are
 *  the card's responsibility inside `matches()` (CR 603.4). */
function firePhaseBeginTriggers(state: GameState): void {
    const event: GameEvent = {
        type: "PHASE_BEGIN",
        phase: state.phase,
        activePlayerId: state.activePlayerId,
    };
    const triggers = collectTriggers(state, [event]);
    // CR 603.3b (ADR 0058) — order same-controller simultaneous phase-begin
    // triggers. No-op on empty; SUSPENDED parks priority on the chooser.
    if (placeTriggersOnStack(state, triggers)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** Dequeue delayed triggers matching `timing`, push them on the stack as
 *  StackItems, and restart priority at the active player (CR 603.3, 603.7a).
 *  Controller-as-APNAP ordering isn't implemented — triggers fire in
 *  scheduling order. */
export function fireDelayedTriggers(
    state: GameState,
    timing: DelayedTriggerInstance["timing"]
): void {
    if (!state.delayedTriggers?.length) return;
    const firing: DelayedTriggerInstance[] = [];
    const remaining: DelayedTriggerInstance[] = [];
    for (const t of state.delayedTriggers) {
        // A `next-draw-step` / `next-main-phase` instance fires only on its
        // target player's draw step / main phase (CR 504 / CR 505); the
        // global-boundary timings ignore `targetPlayerId`.
        const matches =
            t.timing === timing &&
            (t.targetPlayerId === undefined ||
                t.targetPlayerId === state.activePlayerId);
        (matches ? firing : remaining).push(t);
    }
    state.delayedTriggers = remaining.length > 0 ? remaining : undefined;
    if (firing.length === 0) return;
    for (const t of firing) {
        state.stack.push(buildDelayedTriggerStackItem(state, t));
    }
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
}

/** Emits one BLOCKERS_CONFIRMED event per attacker-blocker pair and pushes
 *  any matching triggers onto the stack (CR 509.1h — "blocks or becomes
 *  blocked by" triggers). Called from both the manual `confirmBlockers`
 *  mutation and the auto-confirm path in `drainAutoPasses`. */
export function emitBlockersConfirmedEvents(state: GameState): void {
    if (!state.combat) return;
    const events: GameEvent[] = [];
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);

    // Track which attackers got at least one blocker so we can emit a
    // CR 509.1h "attacker remained unblocked" event for the rest.
    const blockedAttackerIds = new Set<string>();
    for (const [blockerId, attackerIds] of Object.entries(
        state.combat.blockerAssignments
    )) {
        const blocker =
            defender.battlefield.find((c) => c.id === blockerId) ??
            activePlayer.battlefield.find((c) => c.id === blockerId);
        if (!blocker) continue;
        for (const attackerId of attackerIds) {
            const attacker =
                activePlayer.battlefield.find((c) => c.id === attackerId) ??
                defender.battlefield.find((c) => c.id === attackerId);
            if (!attacker) continue;
            blockedAttackerIds.add(attacker.id);
            events.push({
                type: "BLOCKERS_CONFIRMED",
                attackerId: attacker.id,
                attackerControllerId: attacker.controllerId,
                attackerTypes: attacker.types,
                attackerSubtypes: attacker.subtypes,
                // CR 613 effective toughness, so toughness-gated combat-pairing
                // triggers (Infinite Authority, Infernal Medusa) read the live
                // value including counters / continuous effects.
                attackerToughness: getEffectiveToughness(state, attacker),
                blockerId: blocker.id,
                blockerControllerId: blocker.controllerId,
                blockerTypes: blocker.types,
                blockerSubtypes: blocker.subtypes,
                blockerToughness: getEffectiveToughness(state, blocker),
            });
        }
    }
    // CR 509.1h — one ATTACKER_UNBLOCKED event per attacker with no assigned
    // blocker (Murk Dwellers' "attacks and isn't blocked" pump).
    for (const attackerId of state.combat.attackerIds) {
        if (blockedAttackerIds.has(attackerId)) continue;
        const attacker =
            activePlayer.battlefield.find((c) => c.id === attackerId) ??
            defender.battlefield.find((c) => c.id === attackerId);
        if (!attacker) continue;
        events.push({
            type: "ATTACKER_UNBLOCKED",
            attackerId: attacker.id,
            attackerControllerId: attacker.controllerId,
            attackerTypes: attacker.types,
            attackerSubtypes: attacker.subtypes,
        });
    }
    if (events.length === 0) return;
    const triggers = collectTriggers(state, events);
    // CR 603.3b (ADR 0058) — order same-controller simultaneous block triggers.
    if (placeTriggersOnStack(state, triggers)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** Emits a single ATTACKERS_DECLARED event (CR 508.1) once the active player
 *  confirms attackers, and pushes any resulting triggers (Raging River). One
 *  event carries every attacker so a "whenever one or more creatures you
 *  control attack" ability fires exactly once. */
export function emitAttackersDeclaredEvents(state: GameState): void {
    if (!state.combat || state.combat.attackerIds.length === 0) return;
    const event: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: state.activePlayerId,
        attackerIds: [...state.combat.attackerIds],
    };
    const triggers = collectTriggers(state, [event]);
    // CR 603.3b (ADR 0058) — order same-controller simultaneous attack triggers.
    if (placeTriggersOnStack(state, triggers)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** Perform automatic entry actions for the current phase. */
function performPhaseEntry(state: GameState): void {
    switch (state.phase) {
        case "UNTAP":
            // CR 502.1 — "until its controller's next untap step" effects expire
            // as that controller's untap step begins (Orcish Farmer's land-type
            // change). Ticked BEFORE the untap proper so the permanent is back to
            // its printed characteristics for the rest of the step. The tick is
            // keyed to the UNTAP boundary + the effect's controller via
            // `tickDuration`; entries scoped to other boundaries are untouched.
            tickAllDurations(state);
            untapStep(state);
            break;
        case "UPKEEP":
            // CR 500.2 — "until your next upkeep" effects expire as the active
            // player's upkeep begins (Xenic Poltergeist's animation). The tick
            // is keyed to the UPKEEP boundary + the effect's controller via
            // `tickDuration`; entries scoped to end-of-turn / end-of-combat are
            // left untouched here.
            tickAllDurations(state);
            // CR 502.2 / 603.7d — "at the beginning of the next turn's upkeep"
            // delayed triggers (Ice Age cantrips: Blessed Wine, Heal, Flare, …)
            // fire on ENTRY of the very next upkeep regardless of whose turn it
            // is. They carry no `targetPlayerId`, so a single fire dequeues each
            // one exactly once at the first upkeep reached after scheduling.
            fireDelayedTriggers(state, "next-upkeep");
            break;
        case "DRAW":
            drawStep(state);
            // CR 121.1 / 603.2 — the turn-based draw emits CARD_DRAWN; scan it
            // here so "when you draw a card" triggers (Fasting) reach the stack
            // before priority. No-op when no card was drawn (turn 1 / skipped /
            // suspended on a draw-look choice).
            processPendingActionTriggers(state);
            // CR 504.2 — "at the beginning of the draw step" delayed triggers
            // (Nafs Asp's pay-or-lose-life) fire for the active player.
            fireDelayedTriggers(state, "next-draw-step");
            break;
        case "DECLARE_ATTACKERS":
            state.combat = {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            };
            break;
        case "DECLARE_BLOCKERS": {
            // Camouflage (ADR 0012) locks the forced pile blocks into
            // `blockerAssignments` at the spell's resolution (DECLARE_ATTACKERS),
            // and replaces this step entirely — so do NOT reset the assignments;
            // the auto-skip below confirms them with no blocking priority.
            if (state.combat && !state.camouflageCombat) {
                state.combat.blockerAssignments = {};
                state.combat.blockedAttackerIds = undefined;
                state.combat.pendingBlockerId = undefined;
                state.combat.blockersConfirmed = false;
            }
            break;
        }
        case "FIRST_STRIKE_DAMAGE":
        case "COMBAT_DAMAGE": {
            if (state.combat && state.combat.attackerIds.length > 0) {
                const kind: DamageKind =
                    state.phase === "FIRST_STRIKE_DAMAGE"
                        ? "first-strike"
                        : "regular";
                const graph = getEffectiveBlockGraph(state);
                const manualSources = getManualAssignmentSourceIds(
                    state,
                    kind,
                    graph
                );
                if (manualSources.length > 0) {
                    // Pre-fill default assignments and wait for the assigners.
                    state.combat.damageAssignments =
                        buildDefaultDamageAssignments(state, kind);
                    state.combat.damageConfirmed = false;
                    // CR 702.21j-k: compute who assigns each multi-target
                    // source. Normally the source's controller; banding shifts
                    // it to the controller of the banding creature(s) opposite.
                    const assignerIds: Record<string, string> = {};
                    for (const sourceId of manualSources) {
                        const source = findCreature(state, sourceId);
                        if (!source) continue;
                        const targets =
                            graph.blockersByAttacker[sourceId] ??
                            graph.attackersByBlocker[sourceId] ??
                            [];
                        assignerIds[sourceId] = getDamageAssignerId(
                            state,
                            source,
                            targets
                        );
                    }
                    state.combat.damageAssignerIds = assignerIds;
                    state.combat.damageAssignmentConfirmedBy = [];
                } else {
                    // All auto: apply immediately. Clear any per-source assigner
                    // state left from a prior (first-strike) damage step.
                    state.combat.damageAssignerIds = undefined;
                    state.combat.damageAssignmentConfirmedBy = undefined;
                    applyAllCombatDamage(
                        state,
                        buildAutoDamageAssignments(state, kind),
                        kind
                    );
                }
            }
            break;
        }
        case "PRECOMBAT_MAIN":
        case "POSTCOMBAT_MAIN":
            // CR 505 / 603.7 — "at the beginning of your next main phase"
            // delayed triggers (Mana Drain) fire on ENTRY of the controller's
            // next main phase. Main phases only occur on a player's own turn,
            // so the `targetPlayerId === activePlayerId` gate in
            // `fireDelayedTriggers` restricts firing to the scheduling player's
            // turn. Because the trigger is scheduled at spell resolution and a
            // single fire dequeues it, "next" is satisfied: the immediate next
            // main phase the controller reaches consumes it.
            fireDelayedTriggers(state, "next-main-phase");
            break;
        case "END_OF_COMBAT": {
            // CR 511.1 — "at the beginning of the end of combat step" delayed
            // triggers fire on ENTRY. The combat teardown (clearing
            // isAttacking/isBlocking, ending the combat, "until end of combat"
            // effects) is deliberately NOT done here: per CR 511.2 attackers
            // and blockers remain attacking/blocking until the step *ends*, so
            // abilities that target an attacking creature during END_OF_COMBAT
            // (e.g. Desert) stay legal. That teardown runs in `endCombatStep`,
            // invoked on phase EXIT from `advancePhase`.
            fireDelayedTriggers(state, "next-end-of-combat");
            break;
        }
        case "END_STEP": {
            fireDelayedTriggers(state, "next-end-step");
            break;
        }
        case "CLEANUP":
            // CR 514.1 runs first: if the active player's hand exceeds their
            // maximum hand size, they discard down to it before any of the
            // 514.2 turn-based actions fire. The discard requires interactive
            // input, so the step may suspend on a `discard-hand` PendingChoice
            // here — `finalizeCleanup` runs out of the commit handler when the
            // discards land.
            if (tryEnqueueCleanupDiscard(state)) break;
            finalizeCleanup(state);
            break;
    }
}

/** Returns the effective maximum hand size for a player (CR 402.2). The
 *  default is `MAX_HAND_SIZE` (7); the value is mutated by two channels:
 *
 *  - `player.maxHandSizeOverride` — player-scoped override (Vanguard-style
 *    effects that don't live on a battlefield permanent).
 *  - Any `StaticHandSizeOverride` (`kind: "hand-size-override"`) on a
 *    permanent the player controls — Library of Leng / Reliquary Tower
 *    grants "unlimited" while in play, Spellbook-style cards set a numeric
 *    value.
 *
 *  Merge semantics: `"unlimited"` always wins. Among numeric overrides the
 *  largest is taken (most permissive). Absent any override, the default
 *  cap applies. No state mutation — the cap is recomputed on every CLEANUP
 *  entry, so multiple copies / mid-turn enter-and-leave events need no
 *  bookkeeping. */
export function effectiveMaxHandSize(
    player: PlayerState,
    state?: GameState
): number {
    let bestNumeric: number | null = null;
    let unlimited = false;

    const consider = (v: number | "unlimited" | undefined): boolean => {
        if (v === undefined) return false;
        if (v === "unlimited") {
            unlimited = true;
            return true;
        }
        if (bestNumeric === null || v > bestNumeric) bestNumeric = v;
        return false;
    };

    if (consider(player.maxHandSizeOverride)) {
        return Infinity;
    }

    // Default-scoped overrides on the player's own permanents (Library of Leng,
    // Reliquary Tower) apply to their controller.
    for (const card of player.battlefield) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetDefinition(cardId);
        for (const effect of def?.staticEffects ?? []) {
            if (effect.kind !== "hand-size-override") continue;
            // `chosen-player` overrides are read from every battlefield below;
            // skip them here so a Cursed Rack the player controls doesn't cap
            // its own controller.
            if (effect.appliesTo === "chosen-player") continue;
            if (consider(effect.value)) return Infinity;
        }
    }

    // Chosen-player overrides (Cursed Rack) live on a permanent ANY player may
    // control; the override caps the instance's stored `chosenPlayerId`. Scan
    // every battlefield and apply only the ones aimed at this player.
    if (state) {
        for (const owner of state.players) {
            for (const card of owner.battlefield) {
                if (card.chosenPlayerId !== player.id) continue;
                const cardId = (card.card as { id?: string }).id;
                if (!cardId) continue;
                const def = tryGetDefinition(cardId);
                for (const effect of def?.staticEffects ?? []) {
                    if (effect.kind !== "hand-size-override") continue;
                    if (effect.appliesTo !== "chosen-player") continue;
                    if (consider(effect.value)) return Infinity;
                }
            }
        }
    }

    if (unlimited) return Infinity;
    return bestNumeric ?? MAX_HAND_SIZE;
}

/** CR 514.1 — at CLEANUP, if the active player has more cards in hand than
 *  their maximum hand size, they discard down to it. The chooser selects
 *  which cards; the engine suspends on a `discard-hand` PendingChoice
 *  (`stackItemId: ""` — the same phase-level sentinel used by `untap-pick`).
 *  Returns true when a discard prompt was enqueued (caller must NOT run
 *  514.2 yet — wait for the commit handler), false when no discard is
 *  required and CLEANUP can continue immediately. */
function tryEnqueueCleanupDiscard(state: GameState): boolean {
    const active = getPlayer(state, state.activePlayerId);
    const max = effectiveMaxHandSize(active, state);
    const excess = active.hand.length - max;
    if (excess <= 0) return false;
    state.pendingChoices = state.pendingChoices ?? [];
    state.pendingChoices.push({
        stackItemId: "",
        step: 0,
        choiceId: `cleanup-discard-${state.activePlayerId}`,
        playerId: state.activePlayerId,
        zoneOwnerId: state.activePlayerId,
        kind: "discard-hand",
        zone: "hand",
        count: excess,
        prompt:
            excess === 1
                ? "Discard a card (hand size)"
                : `Discard ${excess} cards (hand size)`,
    });
    state.pendingCleanupDiscard = { playerId: state.activePlayerId };
    state.priorityPlayerId = state.activePlayerId;
    return true;
}

/** Commits a CR 514.1 cleanup-discard `PendingChoice`: moves each selected
 *  card out of the chooser's hand (honoring discard replacement effects
 *  like Library of Leng, CR 614), clears the suspension marker, runs the
 *  remainder of CLEANUP (CR 514.2 — damage wipe, "until end of turn"
 *  expiry), then leaves CLEANUP via the normal auto-phase recursion. No-op
 *  if the head choice is not a cleanup discard. */
export function finalizeCleanupDiscard(
    state: GameState,
    selectedIds: string[]
): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (
        !head ||
        head.kind !== "discard-hand" ||
        head.stackItemId !== "" ||
        !state.pendingCleanupDiscard
    ) {
        return;
    }
    const player = getPlayer(state, state.pendingCleanupDiscard.playerId);
    for (const cardInstanceId of selectedIds) {
        // Defense-in-depth: a discard replacement (Library of Leng) earlier
        // in the loop could in principle have routed an id away from hand
        // before the loop reaches it. `findIndex === -1` makes the second
        // pick a silent no-op rather than a throw — matches the SpellContext
        // `discardCard` contract used by Disrupting Scepter / discardAtRandom.
        const idx = player.hand.findIndex((c) => c.id === cardInstanceId);
        if (idx === -1) continue;
        // CR 614 discard replacement (Library of Leng) runs inside
        // discardToGraveyard; a real discard emits CARD_DISCARDED (CR 701.8).
        discardToGraveyard(state, player.id, cardInstanceId);
    }
    // ADR 0026 (revised): the cleanup discard (CR 514.1) does NOT clear a
    // non-owner knower's knowledge of the remaining hand. Discarded cards go to
    // the public graveyard and knowledge is per-instance, so every card left in
    // hand stays identifiable to any prior knower. Only a genuine uncertainty
    // event (shuffle / hidden return to library) revokes hand knowledge.
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
    state.pendingCleanupDiscard = undefined;
    // CR 514.2 — runs only after the discard lands.
    finalizeCleanup(state);

    // CR 514.3 — normally no player receives priority during the cleanup step,
    // but if a turn-based action from 514.1 (here: discarding a card with
    // Madness, whose replacement exiles it and whose reflexive ability triggers)
    // put a triggered ability on the stack, the active player receives priority,
    // players get priority as normal, and a NEW cleanup step begins afterward.
    // Collect any such trigger off the CARD_DISCARDED events the discard emitted;
    // if one landed, hand the active player priority and stay in CLEANUP so the
    // owner gets a real window to cast the madness card (the iconic "discard the
    // extra Rootwalla to hand size, cast it for {0}" line, CR 702.35d). The
    // eventual both-players-pass with an empty stack advances the phase (the
    // "another cleanup step" is a no-op once the hand is at size).
    const cleanupEvents = flushPendingEvents(state);
    const cleanupTriggers =
        cleanupEvents.length > 0 ? collectTriggers(state, cleanupEvents) : [];
    // CR 603.3b (ADR 0058) — LANDED: hand the active player priority and stay in
    // CLEANUP so the owner gets a real window (CR 514.3). SUSPENDED (a rare
    // two-Madness-discard ordering): the helper parked priority on the chooser;
    // stay in CLEANUP until the ordered batch lands.
    if (placeTriggersOnStack(state, cleanupTriggers)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
        return;
    }
    if (state.pendingTriggerBatch) return;

    // CLEANUP is an auto-phase. Leaving it lands at the next turn's UNTAP →
    // UPKEEP via the normal auto-phase recursion (CR 500.1). Drain any
    // auto-pass left on the new active player so priority settles correctly.
    advancePhase(state);
    drainAutoPasses(state);
}

/** CR 514.2 — runs after the (possibly empty) 514.1 discard. Exported so
 *  the commit handler in `game.ts` can resume CLEANUP after the discards
 *  land. "Until end of turn" effects expire, marked damage is removed from
 *  every permanent, and turn-scoped combat flags are cleared. */
export function finalizeCleanup(state: GameState): void {
    // CR 514.2 — "until end of turn" effects end at the cleanup step.
    tickAllDurations(state);
    // CR 514.2 — marked damage is removed from all permanents, and
    // turn-scoped combat flags are cleared.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (card.damageMarked !== undefined) {
                card.damageMarked = undefined;
            }
            // CR 702.2b / 514.2 — the "dealt deathtouch damage this turn" mark
            // is turn-scoped; cleared with marked damage.
            if (card.dealtDeathtouchDamage !== undefined) {
                card.dealtDeathtouchDamage = undefined;
            }
            // CR 508.1 / 514.2 — roll the per-creature attack history forward
            // for the player whose turn is ENDING. `attackedDuringLastTurn`
            // becomes whether this creature attacked during this just-ending
            // turn, snapshotted BEFORE `hasAttackedThisTurn` is cleared below.
            // Only the active player's creatures are updated, so the flag
            // always reflects the controller's most recent PRIOR turn — read
            // by the self attack-restriction predicate (Giant Turtle, LEG).
            if (p.id === state.activePlayerId) {
                card.attackedDuringLastTurn = card.hasAttackedThisTurn
                    ? true
                    : undefined;
            }
            if (card.hasAttackedThisTurn) {
                card.hasAttackedThisTurn = undefined;
            }
            if (card.hasBlockedThisTurn) {
                card.hasBlockedThisTurn = undefined;
            }
            // CR 514.2 — "can attack as though it didn't have defender" is
            // turn-scoped (FEM Vodalian War Machine).
            if (card.canAttackDespiteDefenderThisTurn) {
                card.canAttackDespiteDefenderThisTurn = undefined;
            }
            if (card.damagedBySources !== undefined) {
                card.damagedBySources = undefined;
            }
            // CR 514.2 — "dealt damage to an opponent this turn" is turn-scoped
            // (Whirling Dervish).
            if (card.dealtDamageToOpponentThisTurn !== undefined) {
                card.dealtDamageToOpponentThisTurn = undefined;
            }
            // CR 701.15a — regeneration shields apply only "this turn".
            // Unused shields wear off here.
            if (card.regenerationShields !== undefined) {
                card.regenerationShields = undefined;
            }
            // CR 614.1a — Disintegrate's exile-on-death flag is turn-scoped.
            if (card.exileOnDeath !== undefined) {
                card.exileOnDeath = undefined;
            }
            // CR 701.15c — "can't be regenerated this turn" wears off here
            // (Clergy of the Holy Nimbus's {1} ability).
            if (card.cantBeRegeneratedThisTurn !== undefined) {
                card.cantBeRegeneratedThisTurn = undefined;
            }
            // CR 508.1d — forced-attack flag is turn-scoped.
            if (card.mustAttackThisTurn !== undefined) {
                card.mustAttackThisTurn = undefined;
            }
            if (card.canBlockAdditional !== undefined) {
                card.canBlockAdditional = undefined;
            }
            if (card.mustBlockAllThisTurn) {
                card.mustBlockAllThisTurn = undefined;
            }
            if (card.cantBlockThisTurn) {
                card.cantBlockThisTurn = undefined;
            }
            // CR 508.1a (ADR 0053) — "can't attack this turn" (Fight or
            // Flight's unchosen pile) is turn-scoped.
            if (card.cantAttackThisTurn) {
                card.cantAttackThisTurn = undefined;
            }
            // CR 509.1b — "can't be blocked this turn" (Tawnos's Wand) is
            // turn-scoped.
            if (card.cantBeBlockedThisTurn) {
                card.cantBeBlockedThisTurn = undefined;
            }
            // CR 509.1b — "can't be blocked by [subtype] this turn" (Tower of
            // Coireall) is turn-scoped.
            if (card.cantBeBlockedBySubtypesThisTurn) {
                card.cantBeBlockedBySubtypesThisTurn = undefined;
            }
        }
    }

    // CR 514.2 / 608.2g — a turn-scoped "play that card from exile this turn"
    // impulse grant (Headliner Scarlett, Expressive Iteration) expires at the
    // cleanup step: the card stays exiled but is no longer playable. Revoke it
    // once the current turn has reached the marked expiry turn. Open-ended
    // grants (no `castableFromExileUntilTurn` — Ice Cauldron "as long as it
    // remains exiled"; Robber of the Rich while-source-lives) are untouched.
    for (const p of state.players) {
        for (const card of p.exile) {
            if (
                card.castableFromExileUntilTurn !== undefined &&
                state.turn >= card.castableFromExileUntilTurn
            ) {
                delete card.castableFromExileBy;
                delete card.castableFromExileUntilTurn;
            }
        }
    }

    // CR 702.34 / 514.2 — an instance-level Flashback grant (Snapcaster Mage:
    // "gains flashback until end of turn") expires at the cleanup step. The
    // granted card stays in the graveyard but is no longer castable from there.
    for (const p of state.players) {
        for (const card of p.graveyard) {
            if (card.grantedFlashback !== undefined) {
                delete card.grantedFlashback;
            }
        }
    }

    // CR 603.7a / 514.2 (issue #731) — an instance leave-watch delayed trigger
    // ("when that creature leaves the battlefield THIS TURN, …") that never
    // fired expires here. Every `leaves-battlefield` instance is this-turn
    // scoped, so the whole class is purged at CLEANUP; the phase-boundary
    // timings are left untouched (they fire on a future step, not this turn).
    // Same bound applies to `this-turn-creature-blocks` (CR 603.7d, issue
    // #884, Battle Cry): unlike `leaves-battlefield` it is REPEATING (never
    // dequeued by firing, `triggers.ts`), so it is purged here unconditionally
    // regardless of how many times — including zero — it fired this turn.
    if (state.delayedTriggers?.length) {
        const kept = state.delayedTriggers.filter(
            (t) =>
                t.timing !== "leaves-battlefield" &&
                t.timing !== "this-turn-creature-blocks"
        );
        state.delayedTriggers = kept.length > 0 ? kept : undefined;
    }
}

/** Advances all parametric durations on the current game state by one
 *  phase-boundary tick. Called from END_OF_COMBAT (CR 511.3) and CLEANUP
 *  (CR 514.2); `tickDuration` itself filters by phase+playerId so entries
 *  scoped to a different boundary are left untouched. */
function tickAllDurations(state: GameState): void {
    const view = { phase: state.phase, activePlayerId: state.activePlayerId };

    // CR 611.2b / 613.1b (layer 2) — "gain control until end of turn" control
    // changes (Ray of Command, Magus of the Unseen, issue #730). A duration-
    // scoped `controlChanges` entry reverts at its boundary (CLEANUP, CR 514.2),
    // distinct from the `condition`-based conditional-control SBA. The revert
    // is deferred to a snapshot list because `revertControlChange` moves the
    // host between battlefield arrays — mutating them mid-iteration would
    // perturb the scan. If the entry carries a `tapOnLoss` rider, the permanent
    // is tapped the instant control is lost (CR 701.20a).
    const controlReverts: Array<{
        hostId: string;
        auraId: string;
        tapOnLoss: boolean;
    }> = [];
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.controlChanges?.length) continue;
            for (const entry of card.controlChanges) {
                if (!entry.duration) continue;
                const next = tickDuration(entry.duration, view);
                if (next === null) {
                    controlReverts.push({
                        hostId: card.id,
                        auraId: entry.auraId,
                        tapOnLoss: entry.tapOnLoss ?? false,
                    });
                } else {
                    entry.duration = next;
                }
            }
        }
    }
    for (const r of controlReverts) {
        revertControlChange(state, r.hostId, r.auraId);
        if (!r.tapOnLoss) continue;
        // CR 701.20a — tap the permanent now that control has reverted. It has
        // moved back into its owner's battlefield array; find it by id.
        for (const p of state.players) {
            const host = p.battlefield.find((c) => c.id === r.hostId);
            if (host) {
                tapPermanent(state, host);
                break;
            }
        }
    }

    // Player-granted activated abilities (e.g. Channel).
    for (const p of state.players) {
        if (!p.grantedAbilities?.length) continue;
        const kept: typeof p.grantedAbilities = [];
        for (const grant of p.grantedAbilities) {
            const next = tickDuration(grant.duration, view);
            if (next !== null) kept.push({ ...grant, duration: next });
        }
        p.grantedAbilities = kept.length > 0 ? kept : undefined;
    }

    // Granted static keywords (e.g. Berserk's trample). On expiry, splice
    // one occurrence out of `staticAbilities` so natively-declared
    // duplicates are left untouched (CR 113.1). Aura-sourced grants have
    // no duration — they're managed by the aura's lifetime (see
    // applyAuraStaticEffects / unapplyAuraStaticEffects in state.ts) and
    // pass through this purge unchanged.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.grantedStaticAbilities?.length) continue;
            const kept: typeof card.grantedStaticAbilities = [];
            for (const grant of card.grantedStaticAbilities) {
                if (!grant.duration) {
                    kept.push(grant);
                    continue;
                }
                const next = tickDuration(grant.duration, view);
                if (next === null) {
                    const idx = card.staticAbilities.indexOf(grant.ability);
                    if (idx !== -1) {
                        card.staticAbilities = [
                            ...card.staticAbilities.slice(0, idx),
                            ...card.staticAbilities.slice(idx + 1),
                        ];
                    }
                } else {
                    kept.push({ ...grant, duration: next });
                }
            }
            card.grantedStaticAbilities = kept.length > 0 ? kept : undefined;
        }
    }

    // Granted triggered abilities with a duration (CR 611.1b — Rapid Fire's
    // "gains rampage 2 until end of turn"). Aura-sourced grants carry an
    // `auraId` and no `duration`; they're managed by the aura's lifetime
    // (unapplySourceStaticEffects) and pass through this purge unchanged.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.grantedTriggeredAbilities?.length) continue;
            const kept: typeof card.grantedTriggeredAbilities = [];
            for (const grant of card.grantedTriggeredAbilities) {
                if (!grant.duration) {
                    kept.push(grant);
                    continue;
                }
                const next = tickDuration(grant.duration, view);
                if (next !== null) kept.push({ ...grant, duration: next });
            }
            card.grantedTriggeredAbilities = kept.length > 0 ? kept : undefined;
        }
    }

    // Granted activated abilities with a duration (CR 611.1b — Touch of Vitae's
    // "gains '{0}: Untap this creature. Activate only once.' until end of
    // turn"). Aura-sourced grants carry an `auraId` and no `duration`; they're
    // managed by the aura's lifetime (unapplySourceStaticEffects) and pass
    // through this purge unchanged. Nothing to splice out of `staticAbilities`
    // — a granted activated ability lives only in `grantedActivatedAbilities`.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.grantedActivatedAbilities?.length) continue;
            const kept: typeof card.grantedActivatedAbilities = [];
            for (const grant of card.grantedActivatedAbilities) {
                if (!grant.duration) {
                    kept.push(grant);
                    continue;
                }
                const next = tickDuration(grant.duration, view);
                if (next !== null) kept.push({ ...grant, duration: next });
            }
            card.grantedActivatedAbilities = kept.length > 0 ? kept : undefined;
        }
    }

    // Temporarily removed keywords (CR 611.1b layer 6 — Shelkin Brownie /
    // Tolaria "loses banding / 'bands with other' until end of turn"). On
    // expiry, push one occurrence of the keyword back into `staticAbilities`
    // (CR 113.1 — a native duplicate present at strip time is not double-added,
    // since each stripped occurrence was recorded separately). Mirrors the
    // `grantedStaticAbilities` purge above.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.temporaryRemovedKeywords?.length) continue;
            const kept: typeof card.temporaryRemovedKeywords = [];
            for (const entry of card.temporaryRemovedKeywords) {
                const next = tickDuration(entry.duration, view);
                if (next === null) {
                    card.staticAbilities = [
                        ...card.staticAbilities,
                        entry.keyword,
                    ];
                } else {
                    kept.push({ ...entry, duration: next });
                }
            }
            card.temporaryRemovedKeywords = kept.length > 0 ? kept : undefined;
        }
    }

    // One-shot prevention effects (e.g. Circle of Protection). An effect
    // that hasn't been consumed by the time its duration expires simply
    // wears off.
    if (state.preventionEffects?.length) {
        const kept: typeof state.preventionEffects = [];
        for (const effect of state.preventionEffects) {
            const next = tickDuration(effect.duration, view);
            if (next !== null) kept.push({ ...effect, duration: next });
        }
        state.preventionEffects = kept.length > 0 ? kept : undefined;
    }

    // Target-keyed prevention shields (e.g. Samite Healer, Conservator).
    // Unconsumed remainder wears off at the same boundary.
    if (state.targetPreventionShields?.length) {
        const kept: typeof state.targetPreventionShields = [];
        for (const shield of state.targetPreventionShields) {
            const next = tickDuration(shield.duration, view);
            if (next !== null) kept.push({ ...shield, duration: next });
        }
        state.targetPreventionShields = kept.length > 0 ? kept : undefined;
    }

    // Prevention readback tallies (Sacred Boon). The tally accumulates through
    // the combat-damage step and is read + cleared by the card's next-end-step
    // delayed trigger at END_STEP. It must therefore SURVIVE every earlier
    // phase boundary this function also runs at (END_OF_COMBAT via
    // `endCombatStep`, UNTAP, UPKEEP) — purging it there would wipe the tally
    // before END_STEP ever reads it. Only discard at CLEANUP (CR 514.2), so any
    // leftover (no follow-up ever fired) can't leak into a later turn.
    if (view.phase === "CLEANUP" && state.preventionTallies) {
        state.preventionTallies = undefined;
    }

    // Per-player source-matched prevention shields (Dark Sphere, Scarecrow).
    // Unconsumed remainder wears off at the same boundary (CR 514.2).
    if (state.playerDamagePrevention?.length) {
        const kept: typeof state.playerDamagePrevention = [];
        for (const shield of state.playerDamagePrevention) {
            const next = tickDuration(shield.duration, view);
            if (next !== null) kept.push({ ...shield, duration: next });
        }
        state.playerDamagePrevention = kept.length > 0 ? kept : undefined;
    }

    // Transient damage redirections (Reverse Damage, Jade Monolith {1},
    // Personal Incarnation {0}). Same wear-off semantics as prevention.
    if (state.damageRedirections?.length) {
        const kept: typeof state.damageRedirections = [];
        for (const shield of state.damageRedirections) {
            const next = tickDuration(shield.duration, view);
            if (next === null) continue;
            kept.push({ ...shield, duration: next });
        }
        state.damageRedirections = kept.length > 0 ? kept : undefined;
    }

    // Transient destroy-replacement shields (Pyramids mode 2). Unconsumed
    // remainder wears off at the same boundary (ADR 0020).
    if (state.destroyReplacementShields?.length) {
        const kept: typeof state.destroyReplacementShields = [];
        for (const shield of state.destroyReplacementShields) {
            const next = tickDuration(shield.duration, view);
            if (next === null) continue;
            kept.push({ ...shield, duration: next });
        }
        state.destroyReplacementShields = kept.length > 0 ? kept : undefined;
    }

    // Per-instance combat-damage immunity shields (Ebony Horse). Wear off at
    // the same boundary.
    if (state.combatDamageImmunity?.length) {
        const kept: typeof state.combatDamageImmunity = [];
        for (const shield of state.combatDamageImmunity) {
            const next = tickDuration(shield.duration, view);
            if (next === null) continue;
            kept.push({ ...shield, duration: next });
        }
        state.combatDamageImmunity = kept.length > 0 ? kept : undefined;
    }

    // CR 603.7 / 119 — turn-scoped damage-triggered lifegain effects (Glyph of
    // Life). Unfired remainder wears off at end of turn (CR 514.2).
    if (state.damageTriggeredLifegain?.length) {
        const kept: typeof state.damageTriggeredLifegain = [];
        for (const effect of state.damageTriggeredLifegain) {
            const next = tickDuration(effect.duration, view);
            if (next !== null) kept.push({ ...effect, duration: next });
        }
        state.damageTriggeredLifegain = kept.length > 0 ? kept : undefined;
    }

    // "Becomes a creature" animations (e.g. Jade Statue). On expiry, splice
    // back out anything the animation added and restore the pre-animation
    // P/T so the permanent returns to its original shape.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.animation) continue;
            const next = tickDuration(card.animation.duration, view);
            if (next === null) {
                revertAnimation(card);
            } else {
                card.animation = { ...card.animation, duration: next };
            }
        }
    }

    // Temporary P/T modifications (e.g. Firebreathing's `{R}: ~ gets +1/+0
    // until end of turn`). Purged at the same boundary as `grantedStaticAbilities`
    // and `preventionEffects`.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.temporaryPTMods?.length) continue;
            const kept: typeof card.temporaryPTMods = [];
            for (const mod of card.temporaryPTMods) {
                const next = tickDuration(mod.duration, view);
                if (next !== null) kept.push({ ...mod, duration: next });
            }
            card.temporaryPTMods = kept.length > 0 ? kept : undefined;
        }
    }

    // Layer 7b set-P/T effects (Singing Tree, Sorceress Queen — "base power 0
    // until end of turn"). Purged at the same boundary as `temporaryPTMods`.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.temporaryPTSet?.length) continue;
            const kept: typeof card.temporaryPTSet = [];
            for (const entry of card.temporaryPTSet) {
                // Indefinite set (CR 613.4b — Wall of Tombstones): no duration,
                // never ticked out at a phase boundary. Kept as-is.
                if (entry.duration === undefined) {
                    kept.push(entry);
                    continue;
                }
                const next = tickDuration(entry.duration, view);
                if (next !== null) kept.push({ ...entry, duration: next });
            }
            card.temporaryPTSet = kept.length > 0 ? kept : undefined;
        }
    }

    // Timed subtype changes (CR 305.7 / 611.2 — Orcish Farmer "becomes a Swamp
    // until its controller's next untap step"). On expiry, restore the captured
    // printed subtypes so subtype-driven reads (intrinsic mana, landwalk) revert.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            const change = card.temporarySubtypeChange;
            if (!change) continue;
            const next = tickDuration(change.duration, view);
            if (next === null) {
                card.subtypes = [...change.restoreSubtypes];
                card.temporarySubtypeChange = undefined;
            } else {
                card.temporarySubtypeChange = { ...change, duration: next };
            }
        }
    }

    // Timed colour override (CR 305.7 / 613.1d — issue #1065, Kavu Chameleon
    // "becomes the color of your choice until end of turn"). On expiry,
    // restore whatever colorOverride the permanent carried before (undefined
    // clears it entirely) — mirrors the temporarySubtypeChange purge above.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            const change = card.temporaryColorOverride;
            if (!change) continue;
            const next = tickDuration(change.duration, view);
            if (next === null) {
                card.colorOverride = change.restoreColorOverride
                    ? [...change.restoreColorOverride]
                    : undefined;
                card.temporaryColorOverride = undefined;
            } else {
                card.temporaryColorOverride = { ...change, duration: next };
            }
        }
    }

    // Fog-style blanket combat-damage prevention (CR 615). Only meaningful
    // at CLEANUP — the flag is set at resolution time and lasts until end of
    // turn. Cleared unconditionally so it doesn't persist across turns.
    if (state.preventAllCombatDamageThisTurn) {
        state.preventAllCombatDamageThisTurn = undefined;
    }
    // CR 510.1c / 514.2 — "assigns no combat damage this turn" (Farrel's Mantle,
    // Farrel's Zealot) expires at end of turn.
    if (state.assignsNoCombatDamageThisTurn) {
        state.assignsNoCombatDamageThisTurn = undefined;
    }
    // CR 614.6 / 514.2 — Kjeldoran Royal Guard's turn-scoped combat-damage
    // redirect expires at end of turn.
    if (state.combatDamageRedirectToPermanent) {
        state.combatDamageRedirectToPermanent = undefined;
    }
    // CR 601.3a / 514.2 (issue #1057) — a turn-scoped per-player "can't cast
    // spells this turn" lock (Xantid Swarm) expires at end of turn. Unlike the
    // combat-damage flags above, this MUST survive END_OF_COMBAT (this function
    // also ticks there, CR 511.3): the defending player still can't cast during
    // the postcombat main phase. Cleared only at the CLEANUP boundary.
    if (view.phase === "CLEANUP" && state.cannotCastSpellsThisTurn) {
        state.cannotCastSpellsThisTurn = undefined;
    }
    // CR 602.1 / 605.1a / 514.2 (issue #1124) — a turn-scoped per-player "can't
    // activate abilities that aren't mana abilities" lock (Abeyance) expires at
    // end of turn, same CLEANUP-only boundary as the cast lock above.
    if (view.phase === "CLEANUP" && state.cannotActivateAbilitiesThisTurn) {
        state.cannotActivateAbilitiesThisTurn = undefined;
    }
    // CR 614 / 514.2 (issue #1145) — Yawgmoth's Will's turn-scoped
    // graveyard-bound redirect expires at end of turn, same CLEANUP-only
    // boundary as the cast/activation locks above.
    if (view.phase === "CLEANUP" && state.graveyardBoundRedirectThisTurn) {
        state.graveyardBoundRedirectThisTurn = undefined;
    }
    // ICE Gaze of Pain — the "until end of turn" floating rider expires.
    if (state.gazeOfPainActiveThisTurn) {
        state.gazeOfPainActiveThisTurn = undefined;
    }
    if (state.damageCapShields) {
        state.damageCapShields = undefined;
    }
    // CR 514.2 — Deep Water's "until end of turn" land-mana replacement expires.
    if (state.landManaReplacedToBlueThisTurn) {
        state.landManaReplacedToBlueThisTurn = undefined;
    }
    // CR 514.2 — FEM High Tide's "until end of turn" extra-{U} rider expires.
    if (state.highTideThisTurn) {
        state.highTideThisTurn = undefined;
    }
    // CR 514.2 — Chaos Moon's parametrized "until end of turn" land-mana riders
    // expire (re-armed by the next upkeep trigger).
    if (state.landManaRidersThisTurn) {
        state.landManaRidersThisTurn = undefined;
    }
    if (state.allCreaturesMustAttack) {
        state.allCreaturesMustAttack = undefined;
    }
}

/** Undoes the mutations applied by `animateAsCreature`, restoring the
 *  permanent to its pre-animation shape. Safe to call only on a card whose
 *  `animation` field is set (caller checks). */
function revertAnimation(card: CardInstanceState): void {
    const anim = card.animation;
    if (!anim) return;
    if (anim.addedSubtype !== undefined) {
        const idx = card.subtypes.indexOf(anim.addedSubtype);
        if (idx !== -1) {
            card.subtypes = [
                ...card.subtypes.slice(0, idx),
                ...card.subtypes.slice(idx + 1),
            ];
        }
    }
    // CR 208.2, 611.1: remove exactly the types the animation added — the
    // creature type and any `additionalTypes` (e.g. "Artifact" for Mishra's
    // Factory) — restoring the permanent's original type line.
    const typesToRemove = [
        ...(anim.addedCreatureType ? (["Creature"] as CardType[]) : []),
        ...(anim.addedTypes ?? []),
    ];
    for (const t of typesToRemove) {
        const idx = card.types.indexOf(t);
        if (idx !== -1) {
            card.types = [
                ...card.types.slice(0, idx),
                ...card.types.slice(idx + 1),
            ];
        }
    }
    card.power = anim.savedPower;
    card.toughness = anim.savedToughness;
    card.animation = undefined;
    // CR 704.5g: damage marked on a permanent that's no longer a creature
    // is irrelevant but harmless — cleared at CLEANUP regardless.
}

/** Advance turn: increment counter, swap active player, reset autoPass.
 *  CR 500.7: if an extra turn is queued, the next active player is the one
 *  at the end of the queue (LIFO) instead of the normal turn-order swap.
 *  CR 614.10: if the next active player has skipNextTurn set, clear the flag
 *  and skip their entire turn — advance to the following player instead. */
function advanceTurn(state: GameState): void {
    state.turn += 1;
    // Arboria (CR 508.1c) — freeze the just-ended turn's qualifying-action
    // flag for the OUTGOING active player so "during their last turn" reads a
    // stable value once it's no longer their turn. Captured before the active
    // player swaps below.
    const outgoing = getPlayer(state, state.activePlayerId);
    outgoing.qualifyingActionLastTurn = outgoing.qualifyingActionThisTurn;
    outgoing.qualifyingActionThisTurn = undefined;
    if (state.extraTurns && state.extraTurns.length > 0) {
        const nextActive = state.extraTurns[state.extraTurns.length - 1];
        state.extraTurns = state.extraTurns.slice(0, -1);
        if (state.extraTurns.length === 0) state.extraTurns = undefined;
        state.activePlayerId = nextActive;
    } else {
        state.activePlayerId = getOpponentId(state, state.activePlayerId);
    }
    // CR 614.10: if the next active player's turn should be skipped, clear
    // the flag and recurse to advance past their turn entirely.
    const candidate = getPlayer(state, state.activePlayerId);
    if (candidate.skipNextTurn) {
        candidate.skipNextTurn = undefined;
        advanceTurn(state);
        return;
    }
    // CR 500.1: bump the new active player's per-player turn counter. Extra
    // turns (CR 500.7) increment this normally — the recipient is genuinely
    // taking another of their turns.
    const newActive = getPlayer(state, state.activePlayerId);
    newActive.turnsTaken = (newActive.turnsTaken ?? 0) + 1;
    state.autoPassPlayers = undefined;
    state.singleShotAutoPass = undefined;
    // CR 117.2c / 305.2: reset per-turn land drop count at the start of each turn.
    for (const p of state.players) p.landsPlayedThisTurn = 0;
    // "The last card you drew this turn" (Jandor's Ring) is turn-scoped —
    // clear the tracker so a draw on a prior turn can't pay this turn's cost.
    for (const p of state.players) p.lastDrawnCardId = undefined;
    // The full per-turn draw tally (Sylvan Library "cards drawn this turn") is
    // turn-scoped too — clear it so a prior turn's draws can't be chosen.
    for (const p of state.players) p.drawnThisTurn = undefined;
    // CR 614 — Aladdin's Lamp's draw replacement is "this turn"; any entry not
    // consumed by a draw expires when the next turn begins.
    state.drawLookReplacements = undefined;
    // Reset the per-turn deaths tally so end-step counts are turn-scoped.
    state.deathsThisTurn = undefined;
    // Reset per-turn player damage tally (CR 120.3) — Simulacrum scopes its
    // "damage dealt to you this turn" lookup to the current turn.
    state.damageDealtToPlayerThisTurn = undefined;
    // Reset the per-turn artifact-source damage tally (CR 120.3, artifact-
    // narrowed) — Reverse Polarity scopes "damage dealt to you so far this
    // turn by artifacts" to the current turn.
    state.artifactDamageToPlayerThisTurn = undefined;
    // CR 602.5 — `oncePerTurn` activation counts are per-source per-turn.
    // Clear them across every permanent at turn start so the next turn's
    // first activation isn't blocked by a stale tally.
    for (const p of state.players) {
        for (const c of p.battlefield) {
            if (c.activationsThisTurn) c.activationsThisTurn = undefined;
            // CR 606.3 — the "one loyalty ability per turn" lock is per turn;
            // clear it so each planeswalker may act again on the next turn.
            if (c.loyaltyActivatedThisTurn) {
                c.loyaltyActivatedThisTurn = undefined;
            }
        }
    }
    // Revolt (CR 702.RV): reset the per-player "a permanent you controlled
    // left the battlefield this turn" flag at the start of each turn.
    for (const p of state.players)
        p.permanentYouControlledLeftThisTurn = undefined;
    // Island Sanctuary: clear protection when the protected player's turn starts
    if (
        state.islandSanctuaryProtection &&
        state.islandSanctuaryProtection === state.activePlayerId
    ) {
        state.islandSanctuaryProtection = undefined;
    }
    // Storm (CR 702.40a, ADR 0052) — "this turn" resets at the start of each
    // turn, by any player. A general primitive: future "spells cast this
    // turn" mechanics (prowess/magecraft/Aetherflux-style) read this same
    // field and reset at the same boundary.
    state.spellsCastThisTurn = undefined;
}

/**
 * Advance the game to the next phase/step.
 * Called when both players pass priority with an empty stack.
 * Auto-phases (UNTAP, CLEANUP) are traversed without giving priority.
 * Returns the list of phases traversed (for event emission).
 */
/** Empty mana pools for all players (CR 500.4). Tapped lands become committed (non-untappable until untap step). */
function emptyManaPools(state: GameState): void {
    for (const player of state.players) {
        for (const color of Object.keys(player.manaPool)) {
            player.manaPool[color] = 0;
        }
        // CR 106.6 / 500.4: restricted mana (e.g. Metamorphosis) empties with
        // the rest of the pool at end of step/phase.
        player.restrictedMana = undefined;
        for (const card of player.battlefield) {
            if (card.isTapped) {
                card.manaCommitted = true;
            }
        }
    }
}

function defenderHasAnyLegalBlock(state: GameState): boolean {
    if (!state.combat) return false;
    const defenderId = getOpponentId(state, state.activePlayerId);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const attackers: CardInstanceState[] = [];
    for (const id of state.combat.attackerIds) {
        const card = activePlayer.battlefield.find((c) => c.id === id);
        if (card) attackers.push(card);
    }
    return hasAnyLegalBlock(attackers, defender.battlefield, state);
}

/** CR 511.2/511.3 — runs as the END_OF_COMBAT step *ends*. Creatures stop
 *  being attacking/blocking, "until end of combat" effects end, combat-scoped
 *  pile block restrictions (ADR 0012) lift, and the combat is torn down. This
 *  must happen on phase EXIT, not entry, so that abilities targeting an
 *  attacking creature (e.g. Desert) remain legal throughout the step. */
function endCombatStep(state: GameState): void {
    if (state.combat) {
        const activePlayer = getPlayer(state, state.activePlayerId);
        const defenderId = getOpponentId(state, state.activePlayerId);
        const defender = getPlayer(state, defenderId);
        for (const card of activePlayer.battlefield) {
            card.isAttacking = undefined;
            card.pileLabel = undefined;
        }
        for (const card of defender.battlefield) {
            card.isBlocking = undefined;
            card.pileLabel = undefined;
        }
        state.combat = undefined;
    }
    state.combatBlockRestrictions = undefined;
    // Camouflage's combat-scoped flag lifts with the rest of combat (ADR 0012).
    state.camouflageCombat = undefined;
    // Melee's attacker-chooses-blocks flag is likewise combat-scoped (#669).
    state.meleeCombat = undefined;
    // CR 511.3 — "until end of combat" effects end as the step ends.
    tickAllDurations(state);
}

export function advancePhase(state: GameState): Phase[] {
    const traversed: Phase[] = [];

    // CR 500.4: mana pools empty when a step or phase ends
    emptyManaPools(state);

    // CR 511.2/511.3: combat teardown happens as the END_OF_COMBAT step ends.
    if (state.phase === "END_OF_COMBAT") endCombatStep(state);

    const next = nextPhase(state.phase);

    if (next === null) {
        // End of turn → advance to next turn
        advanceTurn(state);
        state.phase = "UNTAP";
    } else {
        state.phase = next;
    }

    traversed.push(state.phase);

    // Snapshot combat state before entry actions. (The END_OF_COMBAT
    // teardown now runs on exit via `endCombatStep`, so `state.combat` is
    // still present when entering END_OF_COMBAT — attackers stay attacking
    // through the step per CR 511.2.)
    const hadAttackers = !!state.combat && state.combat.attackerIds.length > 0;
    performPhaseEntry(state);

    // CR 603.6a: fire "at the beginning of ~" triggers after the step's
    // turn-based actions. Skipped on auto-phases (UNTAP/CLEANUP) which don't
    // grant priority — triggers scoped to those steps are out of scope for
    // now and would need to be held until the next priority window.
    if (!AUTO_PHASES.has(state.phase)) {
        firePhaseBeginTriggers(state);
    }

    const skipEmptyCombat =
        (state.phase === "DECLARE_BLOCKERS" ||
            state.phase === "FIRST_STRIKE_DAMAGE" ||
            state.phase === "COMBAT_DAMAGE" ||
            state.phase === "END_OF_COMBAT") &&
        !hadAttackers;

    // Auto-skip DECLARE_BLOCKERS when every declared attacker is unblockable
    // (e.g. flying with no reach defender, or landwalk on a matching land —
    // CR 702.9, 702.13). Matches the UX where the defender has no legal
    // target to assign, avoiding a dead-end priority window.
    const skipUnblockableCombat =
        state.phase === "DECLARE_BLOCKERS" &&
        hadAttackers &&
        !!state.combat &&
        !defenderHasAnyLegalBlock(state);
    // Snapshot the stack before any auto blocker-confirm so we can tell whether
    // it pushed "attacks and isn't blocked" triggers (Cloak of Confusion,
    // Farrel's Mantle, Murk Dwellers) that now need a priority window to resolve.
    const stackBeforeBlockerConfirm = state.stack.length;
    if (skipUnblockableCombat && state.combat) {
        state.combat.blockersConfirmed = true;
        recordBlockedAttackers(state);
        // CR 509.1h — even when the defender has no legal block, the
        // ATTACKER_UNBLOCKED turn-based event still fires, so "attacks and
        // isn't blocked" triggers reach the stack. Without this the auto-skip
        // jumps straight to combat damage and silently drops those triggers.
        emitBlockersConfirmedEvents(state);
    }

    // Camouflage (ADR 0012) — the defender's declare-blockers step is replaced:
    // the forced pile blocks were already locked into `blockerAssignments` at
    // the spell's resolution, so confirm them here with no blocking priority
    // window. Marking blockers as blocking + firing the confirmed events keeps
    // the rest of combat (damage assignment, triggers) identical to a normal
    // declare-blockers.
    const skipCamouflageBlockers =
        state.phase === "DECLARE_BLOCKERS" &&
        hadAttackers &&
        !!state.combat &&
        !!state.camouflageCombat &&
        !state.combat.blockersConfirmed;
    if (skipCamouflageBlockers && state.combat) {
        const defenderId = getOpponentId(state, state.activePlayerId);
        const defender = getPlayer(state, defenderId);
        for (const blockerId of Object.keys(state.combat.blockerAssignments)) {
            const card = defender.battlefield.find((c) => c.id === blockerId);
            if (card) {
                card.isBlocking = true;
                card.hasBlockedThisTurn = true;
            }
        }
        state.combat.blockersConfirmed = true;
        recordBlockedAttackers(state);
        emitBlockersConfirmedEvents(state);
    }

    // CR 510.5: skip the first-strike damage step when no combatant has
    // first strike or double strike.
    const skipFirstStrikeDamage =
        state.phase === "FIRST_STRIKE_DAMAGE" &&
        hadAttackers &&
        !anyCombatantHasFirstOrDoubleStrike(state);

    // An auto-phase entry may have enqueued a pending choice (CR 608.2,
    // 502.1 — e.g. UNTAP under Winter Orb prompts the active player to
    // pick which land to untap). In that case do NOT recurse: the engine
    // is suspended awaiting input, and the submitter (`selectResolutionChoice`
    // / `submitResolutionChoice`) is responsible for re-entering this function
    // once the choice is committed. Priority has already been routed to
    // the chooser by the phase-entry hook.
    if ((state.pendingChoices?.length ?? 0) > 0) {
        return traversed;
    }

    // A blocker-confirm auto-skip (unblockable / camouflage) may have pushed
    // "attacks and isn't blocked" triggers onto the stack. When it did, the
    // attacking player needs a priority window to resolve them — do NOT skip
    // straight to combat damage. `emitBlockersConfirmedEvents` already routed
    // priority to the active player, and the else branch below re-affirms it.
    const blockerConfirmPushedTriggers =
        (skipUnblockableCombat || skipCamouflageBlockers) &&
        state.stack.length > stackBeforeBlockerConfirm;

    if (
        !blockerConfirmPushedTriggers &&
        (AUTO_PHASES.has(state.phase) ||
            skipEmptyCombat ||
            skipUnblockableCombat ||
            skipCamouflageBlockers ||
            skipFirstStrikeDamage)
    ) {
        // Auto-phase or empty combat: skip straight through (no priority given)
        traversed.push(...advancePhase(state));
    } else {
        // Priority phase: active player gets priority
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }

    return traversed;
}

/**
 * Drain auto-passes: while the current priority holder is in autoPassPlayers,
 * simulate their pass. Handles both stack resolution and phase advancement.
 * Stops when priority lands on a non-auto-pass player or a new turn begins
 * (which clears autoPassPlayers).
 */
export function drainAutoPasses(state: GameState): void {
    const maxIterations = 50; // safety bound
    for (let i = 0; i < maxIterations; i++) {
        // Consume a queued "Pass Turn" intent: a player who pressed Enter
        // without priority is promoted into a rest-of-turn auto-pass the
        // moment priority lands on them (mirrors `endTurn`). CR 117 — a
        // standing intent to pass that fires on the next priority window.
        if (state.queuedEndTurn?.includes(state.priorityPlayerId)) {
            const promoted = state.autoPassPlayers ?? [];
            if (!promoted.includes(state.priorityPlayerId)) {
                promoted.push(state.priorityPlayerId);
            }
            state.autoPassPlayers = promoted;
            const remaining = state.queuedEndTurn.filter(
                (id) => id !== state.priorityPlayerId
            );
            state.queuedEndTurn = remaining.length > 0 ? remaining : undefined;
        }

        const autoPass = state.autoPassPlayers ?? [];
        const singleShot = state.singleShotAutoPass === state.priorityPlayerId;
        if (!autoPass.includes(state.priorityPlayerId) && !singleShot) break;
        if (singleShot) state.singleShotAutoPass = undefined;

        // Auto-confirm attackers with current selection when auto-passing
        if (
            state.phase === "DECLARE_ATTACKERS" &&
            state.combat &&
            !state.combat.confirmed
        ) {
            const activePlayer = getPlayer(state, state.activePlayerId);
            // CR 508.1d: fold in any eligible creature required to attack.
            for (const requiredId of getRequiredAttackerIds(
                activePlayer.battlefield,
                undefined,
                state.allCreaturesMustAttack
            )) {
                if (!state.combat.attackerIds.includes(requiredId)) {
                    state.combat.attackerIds.push(requiredId);
                }
            }
            for (const attackerId of state.combat.attackerIds) {
                const card = activePlayer.battlefield.find(
                    (c) => c.id === attackerId
                );
                if (card) {
                    if (!card.staticAbilities.includes("vigilance")) {
                        // CR 708.9 / ADR 0013 — face-down attacker turns up as
                        // it taps to attack.
                        tapPermanent(state, card);
                    }
                    card.isAttacking = true;
                    card.hasAttackedThisTurn = true;
                }
            }
            state.combat.confirmed = true;
            state.combat.blockerAssignments = {};
            state.combat.blockersConfirmed = false;
            emitAttackersDeclaredEvents(state);
        }

        // Declare-blockers stop (CR 509.1) — mirrors the `passPriority` guard
        // in game.ts ("Must declare blockers before passing priority"). A
        // standing Pass Turn / auto-pass intent must NEVER skip the defending
        // player's block decision: while attackers are declared, blockers are
        // unconfirmed, and the defender has at least one legal block, halt the
        // drain and hand the defender a genuine declare-blockers window. Their
        // pass intent is preserved, so the drain resumes for the rest of the
        // turn once they confirm blockers.
        //
        // When the defender has no legal block, phase entry already set
        // `blockersConfirmed` (`skipUnblockableCombat`), so we only reach this
        // branch unconfirmed when a real block exists; the fall-through
        // auto-confirm below is a defensive no-op for any edge that slips past.
        if (
            state.phase === "DECLARE_BLOCKERS" &&
            state.combat &&
            !state.combat.blockersConfirmed
        ) {
            const defenderId = getOpponentId(state, state.activePlayerId);
            if (defenderHasAnyLegalBlock(state)) {
                state.priorityPlayerId = defenderId;
                return;
            }
            const defender = getPlayer(state, defenderId);
            for (const blockerId of Object.keys(
                state.combat.blockerAssignments
            )) {
                const card = defender.battlefield.find(
                    (c) => c.id === blockerId
                );
                if (card) {
                    card.isBlocking = true;
                    card.hasBlockedThisTurn = true;
                }
            }
            state.combat.pendingBlockerId = undefined;
            state.combat.blockersConfirmed = true;
            recordBlockedAttackers(state);
            emitBlockersConfirmedEvents(state);
        }

        // Auto-confirm damage assignment when active player auto-passes
        if (
            (state.phase === "FIRST_STRIKE_DAMAGE" ||
                state.phase === "COMBAT_DAMAGE") &&
            state.combat &&
            state.combat.damageConfirmed === false
        ) {
            const kind: DamageKind =
                state.phase === "FIRST_STRIKE_DAMAGE"
                    ? "first-strike"
                    : "regular";
            applyAllCombatDamage(
                state,
                state.combat.damageAssignments ?? {},
                kind
            );
            state.combat.damageConfirmed = true;
        }

        state.passCount += 1;

        if (state.passCount >= 2 && state.stack.length > 0) {
            resolveTopOfStack(state);
            if ((state.pendingChoices?.length ?? 0) > 0) {
                // Resolution suspended on a pending choice (CR 608.2) — this also
                // covers the reflexive Madness cast-choice (CR 702.35d), pushed
                // as a blocking pending choice. Priority moves to the chooser and
                // auto-drain stops; the submit mutation resumes from here.
                state.priorityPlayerId = state.pendingChoices![0].playerId;
                return;
            }
            if (state.pendingTarget) {
                // Resolution requested a copy-retarget (CR 707.10b, Fork) —
                // priority moves to the chooser and auto-drain stops until
                // they select or decline new targets.
                state.priorityPlayerId = state.pendingTarget.playerId;
                return;
            }
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
        } else if (state.passCount >= 2 && state.stack.length === 0) {
            advancePhase(state);
            // advanceTurn clears autoPassPlayers, so the loop will exit naturally
        } else {
            state.priorityPlayerId = getOpponentId(
                state,
                state.priorityPlayerId
            );
        }
    }
}

/** Returns true if sorcery-speed actions are legal (main phase, empty stack, active player has priority). */
export function isSorceryTiming(state: GameState): boolean {
    return (
        (state.phase === "PRECOMBAT_MAIN" ||
            state.phase === "POSTCOMBAT_MAIN") &&
        state.stack.length === 0 &&
        state.priorityPlayerId === state.activePlayerId
    );
}
