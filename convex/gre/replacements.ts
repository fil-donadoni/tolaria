// Replacement effects engine (CR 614 / 616).
//
// Replacement effects intercept a game event BEFORE the original action runs
// and either rewrite the event payload (damage redirected, lifegain converted
// to draw) or cancel the event entirely (Lich's "don't lose the game"). They
// are continuous effects active while their source is on the battlefield.
//
// Apply order at any damage / life-change / discard / lose-game site:
//   1. CR 614 replacement loop (this module)
//   2. CR 615 prevention shields (existing `consumePreventionIfAny` /
//      `applyTargetPrevention` in state.ts)
//   3. Original action runs against the (possibly rewritten) payload.
//
// CR 616.1d: a given replacement applies at most once per event. The loop
// tracks `(sourceInstanceId|effectId)` keys to honor that, and is bounded by
// a sanity cap (64 iterations) against pathological cycles. Player choice of
// replacement order (CR 616.1c) is currently deterministic — APNAP, then
// battlefield-declaration order. Adequate for the present LEA card set.

import type {
    AsEntersChoice,
    CardType,
    Color,
    DamageReplacementEvent,
    DestroyReplacementEvent,
    DiscardReplacementEvent,
    DrawReplacementEffect,
    DrawReplacementEvent,
    EntersBattlefieldReplacementEvent,
    GraveyardBoundReplacementEvent,
    LifeChangeReplacementEvent,
    LoseGameReplacementEvent,
    PermanentView,
    ReplacementApplyContext,
    ReplacementEffect,
    ReplacementEvent,
    ReplacementEventKind,
    ReplacementStateView,
    TapReplacementEvent,
} from "../cards/types";
import { tryGetDefinition } from "../cards";
import { getColorsFromCost } from "../cards/colors";
import { isDamageablePermanent } from "./constants";
import { turnFaceUp } from "./faceDown";
import { STATIC_EFFECT_CTX } from "./layers";
import type { CardInstanceState, DamageRedirection, GameState } from "./state";
import {
    bumpDamageDealtToPlayer,
    emitLifeLost,
    gainLifeEmitting,
    getPlayer,
    moveCard,
    putHandCardOnTopOfLibrary,
} from "./state";

function collectReplacements(
    state: GameState,
    kind: ReplacementEventKind
): { source: CardInstanceState; effect: ReplacementEffect }[] {
    const active = state.players.find((p) => p.id === state.activePlayerId);
    const opponents = state.players.filter(
        (p) => p.id !== state.activePlayerId
    );
    const ordered = active ? [active, ...opponents] : state.players;

    const out: { source: CardInstanceState; effect: ReplacementEffect }[] = [];
    for (const player of ordered) {
        for (const card of player.battlefield) {
            const cardId = (card.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            const effects = def?.replacementEffects ?? [];
            for (const r of effects) {
                if (r.eventKind === kind) out.push({ source: card, effect: r });
            }
        }
    }
    return out;
}

function buildStateView(state: GameState): ReplacementStateView {
    let combat: ReplacementStateView["combat"];
    if (state.combat) {
        const blockersByAttacker: Record<string, string[]> = {};
        for (const id of state.combat.attackerIds) blockersByAttacker[id] = [];
        for (const [blockerId, attackerIds] of Object.entries(
            state.combat.blockerAssignments
        )) {
            for (const attackerId of attackerIds) {
                if (blockersByAttacker[attackerId])
                    blockersByAttacker[attackerId].push(blockerId);
            }
        }
        combat = {
            attackerIds: state.combat.attackerIds,
            blockersByAttacker,
            bands: state.combat.bands?.map((b) => ({
                memberIds: b.memberIds,
            })),
        };
    }
    return {
        players: state.players.map((p) => ({
            id: p.id,
            life: p.life,
            handSize: p.hand.length,
            battlefield: p.battlefield.map((c) => ({
                id: c.id,
                controllerId: c.controllerId,
                ownerId: c.ownerId,
                types: c.types,
                subtypes: c.subtypes,
                staticAbilities: c.staticAbilities,
                isToken: c.isToken === true,
                // CR 202.2 / 613.1e layer 5 (issue #1083) — the same effective
                // color reader static-effect predicates use, so a replacement
                // predicate can read a TARGET creature's color (Well-Laid
                // Plans), not just the damage source's (already on the event).
                colors: STATIC_EFFECT_CTX.getColors(c),
            })),
            preferences: state.playerPreferences?.[p.id],
        })),
        combat,
    };
}

function buildPermanentView(card: CardInstanceState): PermanentView {
    return {
        id: card.id,
        controllerId: card.controllerId,
        ownerId: card.ownerId,
        types: card.types,
        subtypes: card.subtypes,
        isTapped: card.isTapped,
        power: card.power,
        toughness: card.toughness,
        attachedTo: card.attachedTo,
        chosenModeId: card.chosenModeId,
        counters: card.counters,
        card: card.card as Record<string, unknown>,
    };
}

/** CR 614 / 616.1 (ADR 0061) — discovers every draw replacement applicable to
 *  `event`, in the order the AFFECTED player (the drawing player, CR 616.1c)
 *  would apply them: the drawing player's OWN permanents first, then others,
 *  each in battlefield-declaration order. A draw replacement lives on a card
 *  definition's `drawReplacement` field (NOT the sync `replacementEffects[]`,
 *  because a draw replacement is applied at the resumable draw seam), so this
 *  is a separate scan from `collectReplacements`. The seam applies the FIRST
 *  entry: bin / prevent / draw are terminal outcomes that end the draw; only a
 *  `modify-count` outcome would chain, which the seam handles inline. A full
 *  interactive pick-order prompt for two co-applicable replacements is deferred
 *  (no two draw replacements affect the same draw in the current set); the
 *  deterministic affected-player ordering is CR-faithful for the one-source
 *  case and gives a stable order for the two-source case. */
export function getApplicableDrawReplacements(
    state: GameState,
    event: DrawReplacementEvent
): { source: CardInstanceState; effect: DrawReplacementEffect }[] {
    const view = buildStateView(state);
    const own: { source: CardInstanceState; effect: DrawReplacementEffect }[] =
        [];
    const others: {
        source: CardInstanceState;
        effect: DrawReplacementEffect;
    }[] = [];
    for (const player of state.players) {
        for (const card of player.battlefield) {
            const cardId = (card.card as { id?: string }).id;
            if (!cardId) continue;
            const effect = tryGetDefinition(cardId)?.drawReplacement;
            if (!effect) continue;
            const permView = buildPermanentView(card);
            if (!effect.applies(event, permView, view)) continue;
            (card.controllerId === event.drawingPlayer ? own : others).push({
                source: card,
                effect,
            });
        }
    }
    return [...own, ...others];
}

/** The single draw replacement the seam applies to `event` (CR 616.1 — the
 *  affected player's first-ordered applicable replacement), or undefined. */
export function getFirstApplicableDrawReplacement(
    state: GameState,
    event: DrawReplacementEvent
): { source: CardInstanceState; effect: DrawReplacementEffect } | undefined {
    return getApplicableDrawReplacements(state, event)[0];
}

function buildApplyCtx(
    state: GameState,
    source: CardInstanceState
): ReplacementApplyContext {
    return {
        apNapOrder: () => {
            const active = state.activePlayerId;
            const others = state.players
                .filter((p) => p.id !== active)
                .map((p) => p.id);
            return [active, ...others];
        },
        drawCards: (playerId, amount) => {
            const player = getPlayer(state, playerId);
            for (let i = 0; i < amount; i++) {
                if (player.library.length === 0) {
                    player.hasDrawnFromEmpty = true;
                    return;
                }
                const drawn = moveCard(
                    player,
                    player.library[0].id,
                    "library",
                    "hand"
                );
                // Track the last card drawn this turn (CR — Jandor's Ring).
                player.lastDrawnCardId = drawn.id;
                // Full per-turn draw tally (CR 121.1) — Sylvan Library.
                player.drawnThisTurn = [
                    ...(player.drawnThisTurn ?? []),
                    drawn.id,
                ];
            }
        },
        moveHandCardToLibraryTop: (playerId, cardInstanceId) =>
            putHandCardOnTopOfLibrary(
                getPlayer(state, playerId),
                cardInstanceId
            ),
        revealHandCard: () => {
            // CR 701.15 reveal: publicly note the card's identity. Currently a
            // no-op for state — the replacement caller already inspects the
            // card via state, and the UI surfaces hand contents through the
            // game projection. A future event-log entry would land here.
        },
        adjustLifeRaw: (playerId, delta) => {
            getPlayer(state, playerId).life += delta;
        },
        removeCounter: (type, count) => {
            if (!source.counters) return 0;
            const current = source.counters[type] ?? 0;
            const removed = Math.min(current, count);
            if (removed <= 0) return 0;
            source.counters[type] = current - removed;
            if (source.counters[type] === 0) delete source.counters[type];
            return removed;
        },
        turnSelfFaceUp: () => {
            turnFaceUp(source);
            return {
                power: source.power ?? 0,
                toughness: source.toughness ?? 0,
            };
        },
        state: buildStateView(state),
        self: buildPermanentView(source),
    };
}

function applyReplacementsLoop(
    state: GameState,
    kind: ReplacementEventKind,
    initial: ReplacementEvent
): ReplacementEvent | null {
    let event = initial;
    const used = new Set<string>();
    for (let i = 0; i < 64; i++) {
        const candidates = collectReplacements(state, kind);
        let pick: {
            source: CardInstanceState;
            effect: ReplacementEffect;
        } | null = null;
        const stateView = buildStateView(state);
        for (const c of candidates) {
            const key = `${c.source.id}|${c.effect.id}`;
            if (used.has(key)) continue;
            const view = buildPermanentView(c.source);
            if (!c.effect.appliesTo(event, view, stateView)) continue;
            pick = c;
            break;
        }
        if (!pick) return event;
        used.add(`${pick.source.id}|${pick.effect.id}`);
        const ctx = buildApplyCtx(state, pick.source);
        const result = pick.effect.replace(event, ctx);
        if (result.kind === "consumed") return null;
        event = result.event;
    }
    return event;
}

export function applyDamageReplacements(
    state: GameState,
    event: DamageReplacementEvent
): DamageReplacementEvent | null {
    const result = applyReplacementsLoop(state, "damage", event);
    return result === null ? null : (result as DamageReplacementEvent);
}

/** Runs CR 614 tap replacements (face-down turn-up, ADR 0013). Returns the
 *  (possibly rewritten) event, or null if a replacement cancels the tap. The
 *  face-down turn-up effect never cancels — it turns the creature up and lets
 *  the tap proceed against its real self. */
export function applyTapReplacements(
    state: GameState,
    event: TapReplacementEvent
): TapReplacementEvent | null {
    const result = applyReplacementsLoop(state, "tap", event);
    return result === null ? null : (result as TapReplacementEvent);
}

/** Runs CR 614 destroy replacements (ADR 0020). Consults permanent-bound
 *  `replacementEffects[]` with `eventKind: "destroy"` first, then the transient
 *  `state.destroyReplacementShields` (Pyramids mode 2). Returns the event if
 *  the destruction should proceed, or null if a replacement intercepted it —
 *  in which case the permanent stays on the battlefield. Regeneration is
 *  deliberately NOT handled here (it remains a specialised shield inside
 *  `regenerateOrDestroy`). */
export function applyDestroyReplacements(
    state: GameState,
    event: DestroyReplacementEvent
): DestroyReplacementEvent | null {
    const continuous = applyReplacementsLoop(state, "destroy", event);
    if (continuous === null) return null;
    return applyTransientDestroyShields(
        state,
        continuous as DestroyReplacementEvent
    );
}

/** Consumes a transient destroy-replacement shield keyed to the event's
 *  target (Pyramids mode 2). On a match: removes one charge, heals the saved
 *  permanent's marked damage (oracle "remove all damage marked on it
 *  instead"), and returns null so the destruction is replaced. Otherwise
 *  returns the event unchanged. */
function applyTransientDestroyShields(
    state: GameState,
    event: DestroyReplacementEvent
): DestroyReplacementEvent | null {
    const shields = state.destroyReplacementShields;
    if (!shields || shields.length === 0) return event;
    const idx = shields.findIndex(
        (s) => s.targetInstanceId === event.targetInstanceId && s.remaining > 0
    );
    if (idx === -1) return event;
    const shield = shields[idx];
    const kept = [
        ...shields.slice(0, idx),
        ...(shield.remaining - 1 > 0
            ? [{ ...shield, remaining: shield.remaining - 1 }]
            : []),
        ...shields.slice(idx + 1),
    ];
    state.destroyReplacementShields = kept.length > 0 ? kept : undefined;
    // Oracle "remove all damage marked on it instead" — the saved permanent
    // sheds its marked damage so the same lethal hit doesn't re-destroy it.
    const saved = findOnBattlefieldAnywhere(state, event.targetInstanceId);
    if (saved && saved.damageMarked !== undefined) {
        delete saved.damageMarked;
    }
    return null;
}

/** Applies transient one-shot damage shields stored in
 *  `state.damageRedirections` (CR 614 — Reverse Damage / Jade Monolith /
 *  Personal Incarnation activated). Runs AFTER continuous replacements so a
 *  permanent-bound redirect (Veteran Bodyguard) gets first crack at the
 *  event. Each kind of shield is one-shot: consumed shields are spliced out
 *  of `state.damageRedirections`. Returns the (possibly rewritten) event,
 *  or null if a shield consumed the event entirely. */
export function applyTransientDamageRedirections(
    state: GameState,
    event: DamageReplacementEvent
): DamageReplacementEvent | null {
    const shields = state.damageRedirections;
    if (!shields || shields.length === 0) return event;
    const kept: DamageRedirection[] = [];
    let current = event;
    let consumed = false;
    // Reverse Damage's life gain is DEFERRED to after the shield array is
    // written back (see below). `gainLifeEmitting` runs the CR 614 lifegain
    // replacement layer, which can execute arbitrary card effects (Lich's
    // "draw that many cards instead"); running it mid-loop would let a nested
    // effect mutate `state.damageRedirections` only for this function's
    // end-of-loop `kept` writeback to clobber it. Deferring keeps the
    // in-flight damage event and the shield bookkeeping untouched.
    let pendingLifeGain: { playerId: string; amount: number } | null = null;
    for (let i = 0; i < shields.length; i++) {
        const sh = shields[i];
        if (consumed) {
            kept.push(sh);
            continue;
        }
        if (sh.kind === "prevent-from-source-gain-life") {
            if (
                current.target.type === "player" &&
                current.target.id === sh.playerId &&
                current.sourceInstanceId === sh.sourceInstanceId
            ) {
                // Reverse Damage: prevent the damage and gain life equal to
                // the amount that was prevented. The shield is one-shot. The
                // gain is routed through the single life-gain choke point
                // (CR 119.3) — deferred to the end of this function so the
                // tally/LIFE_GAINED emission can't disturb the shield loop.
                pendingLifeGain = {
                    playerId: sh.playerId,
                    amount: current.amount,
                };
                consumed = true;
                // splice this shield: do not push back
                continue;
            }
            kept.push(sh);
        } else if (sh.kind === "to-self-redirect-to-owner") {
            if (
                current.target.type === "permanent" &&
                current.target.id === sh.targetInstanceId &&
                sh.remaining > 0
            ) {
                const targetCard = findOnBattlefieldAnywhere(
                    state,
                    sh.targetInstanceId
                );
                if (!targetCard) {
                    kept.push(sh);
                    continue;
                }
                const ownerId = targetCard.ownerId;
                // Redirect this damage to the permanent's owner. Decrement
                // the shield's remaining count and keep it if it still has
                // charges (Personal Incarnation's "{0}: next 1 damage to
                // this creature" stacks one charge per activation).
                const absorb = Math.min(current.amount, sh.remaining);
                if (absorb >= current.amount) {
                    current = {
                        ...current,
                        target: { type: "player", id: ownerId },
                    };
                    if (sh.remaining - current.amount > 0) {
                        kept.push({
                            ...sh,
                            remaining: sh.remaining - current.amount,
                        });
                    }
                } else {
                    // Partial redirect: in current model we redirect the
                    // full amount when the shield has any charge — splitting
                    // a single damage event across both target and owner
                    // would require emitting two events. LEA scope keeps
                    // amounts compatible with sh.remaining = 1.
                    current = {
                        ...current,
                        target: { type: "player", id: ownerId },
                    };
                }
            } else {
                kept.push(sh);
            }
        } else if (sh.kind === "reflect-to-source-controller") {
            if (
                current.target.type === "player" &&
                current.target.id === sh.playerId &&
                current.sourceInstanceId === sh.sourceInstanceId &&
                sh.remaining > 0
            ) {
                // Eye for an Eye (CR 614): the damage to the chosen player is
                // NOT reduced — it proceeds unchanged. Additionally, deal an
                // equal amount to the source's controller. Applied as a raw
                // life adjustment + tally (mirrors Reverse Damage's gain-life
                // here) rather than re-entering the full damage pipeline.
                const reflectTo = current.sourceControllerId;
                getPlayer(state, reflectTo).life -= current.amount;
                // CR 119.3 — this reflected damage causes life loss; emit
                // LIFE_LOST so "whenever you lose life" triggers fire.
                emitLifeLost(state, reflectTo, current.amount, true);
                bumpDamageDealtToPlayer(state, reflectTo, current.amount);
                if (sh.remaining - 1 > 0) {
                    kept.push({ ...sh, remaining: sh.remaining - 1 });
                }
                // do not modify `current` — the original damage still lands.
                continue;
            }
            kept.push(sh);
        } else if (sh.kind === "from-source-to-permanent-redirect") {
            const sourceMatches =
                sh.sourceInstanceId === undefined ||
                sh.sourceInstanceId === current.sourceInstanceId;
            if (
                sourceMatches &&
                current.target.type === "permanent" &&
                current.target.id === sh.targetInstanceId &&
                sh.remaining > 0
            ) {
                // Jade Monolith / Mirrorwood Treefolk (CR 614): redirect
                // damage to the chosen destination — a player or a
                // permanent (issue #1939 generalization). Official ruling
                // (Mirrorwood Treefolk, Scryfall/Gatherer): "If the target
                // creature is not on the battlefield (or is not a creature)
                // at the time the damage would be redirected, then the
                // damage goes on this card." So a permanent destination must
                // be re-validated at redirection time — the same
                // existence/damageability gate the sibling
                // `to-self-redirect-to-owner` branch above already applies
                // to ITS target (`findOnBattlefieldAnywhere` +
                // `isDamageablePermanent`). On an illegal destination,
                // `current.target` is left untouched (it already IS the
                // shielded creature, since its id === sh.targetInstanceId),
                // so the damage lands there instead of vanishing. The "next
                // time" is still spent either way — charges decrement per
                // match regardless of whether the redirect actually landed.
                let destinationValid = true;
                if (sh.redirectTo.type === "permanent") {
                    const destCard = findOnBattlefieldAnywhere(
                        state,
                        sh.redirectTo.id
                    );
                    destinationValid =
                        destCard !== undefined &&
                        isDamageablePermanent(destCard);
                }
                if (destinationValid) {
                    current = {
                        ...current,
                        target: sh.redirectTo,
                    };
                }
                if (sh.remaining - 1 > 0) {
                    kept.push({ ...sh, remaining: sh.remaining - 1 });
                }
                continue;
            }
            kept.push(sh);
        }
    }
    state.damageRedirections = kept.length > 0 ? kept : undefined;
    // Reverse Damage's gain, now that the shield bookkeeping is committed.
    if (pendingLifeGain !== null) {
        gainLifeEmitting(
            state,
            pendingLifeGain.playerId,
            pendingLifeGain.amount
        );
    }
    return consumed ? null : current;
}

function findOnBattlefieldAnywhere(
    state: GameState,
    instanceId: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const hit = p.battlefield.find((c) => c.id === instanceId);
        if (hit) return hit;
    }
    return undefined;
}

export function applyLifeChangeReplacements(
    state: GameState,
    event: LifeChangeReplacementEvent
): LifeChangeReplacementEvent | null {
    const kind = event.kind === "lifegain" ? "lifegain" : "lifeloss";
    const result = applyReplacementsLoop(state, kind, event);
    return result === null ? null : (result as LifeChangeReplacementEvent);
}

export function applyDiscardReplacements(
    state: GameState,
    event: DiscardReplacementEvent
): DiscardReplacementEvent | null {
    const result = applyReplacementsLoop(state, "discard", event);
    return result === null ? null : (result as DiscardReplacementEvent);
}

export function applyLoseGameReplacements(
    state: GameState,
    event: LoseGameReplacementEvent
): LoseGameReplacementEvent | null {
    const result = applyReplacementsLoop(state, "lose-game", event);
    return result === null ? null : (result as LoseGameReplacementEvent);
}

/** Consumes a turn-scoped graveyard-bound redirect grant (`state
 *  .graveyardBoundRedirectThisTurn`, CR 614/514.2 — Yawgmoth's Will's
 *  redirect clause), keyed to the event's `ownerId`. Distinct from the
 *  permanent-bound `replacementEffects[]` loop above (Dauthi Voidwalker):
 *  a one-shot sorcery has no battlefield presence to carry a continuous
 *  effect, so its "until end of turn" grant lives here instead — mirrors
 *  `applyTransientDestroyShields`. Runs AFTER the continuous loop so a
 *  permanent-bound effect gets first crack; a no-op once `destination` is
 *  already redirected (CR 616.1d — a redirected event isn't re-intercepted). */
function applyTransientGraveyardRedirects(
    state: GameState,
    event: GraveyardBoundReplacementEvent
): GraveyardBoundReplacementEvent {
    if (event.destination !== "graveyard") return event;
    const grants = state.graveyardBoundRedirectThisTurn;
    if (!grants || grants.length === 0) return event;
    const match = grants.find((g) => g.ownerId === event.ownerId);
    if (!match) return event;
    return {
        ...event,
        destination: "exile",
        tagCounters: match.tagCounters,
    };
}

/** Runs CR 614 graveyard-bound replacements (issue #1145) — "if a card
 *  would be put into a/your/an opponent's graveyard from anywhere, exile it
 *  instead" (Yawgmoth's Will, Dauthi Voidwalker). Unlike `destroy`/`discard`
 *  this event never fully cancels: a card entering a graveyard always ends
 *  up somewhere, so a matching replacement rewrites `event.destination` to
 *  `"exile"` (and optionally `event.tagCounters`) rather than returning
 *  `{kind:"consumed"}`. Always returns a non-null event; the `?? event`
 *  fallback only guards a replacement author misusing `"consumed"` (a
 *  contract violation caught by validation/tests, not expected at runtime).
 *  Consults the permanent-bound loop FIRST, then the turn-scoped transient
 *  grant layer (Yawgmoth's Will) — the same two-layer shape as
 *  `applyDestroyReplacements`/`applyTransientDestroyShields`. */
export function applyGraveyardBoundReplacements(
    state: GameState,
    event: GraveyardBoundReplacementEvent
): GraveyardBoundReplacementEvent {
    const result = applyReplacementsLoop(state, "graveyard-bound", event);
    const settled = (result as GraveyardBoundReplacementEvent | null) ?? event;
    return applyTransientGraveyardRedirects(state, settled);
}

/** Convenience wrapper around `applyGraveyardBoundReplacements` for the
 *  zone-change chokepoints (mill, discard-resolution, SBA/sacrifice/destroy
 *  death path, spell resolution/countering) that only need the resolved
 *  destination + any counters to stamp, not the full event shape. */
export function graveyardDestinationFor(
    state: GameState,
    cardInstanceId: string,
    ownerId: string,
    fromZone: GraveyardBoundReplacementEvent["fromZone"]
): {
    destination: "graveyard" | "exile";
    tagCounters?: Record<string, number>;
} {
    const result = applyGraveyardBoundReplacements(state, {
        kind: "graveyard-bound",
        cardInstanceId,
        ownerId,
        fromZone,
        destination: "graveyard",
    });
    return { destination: result.destination, tagCounters: result.tagCounters };
}

/** Stamps `tagCounters` (Dauthi Voidwalker's void counter) onto a card that
 *  a graveyard-bound replacement redirected away from the graveyard. No-op
 *  when there's nothing to tag. */
export function applyGraveyardRedirectCounters(
    card: CardInstanceState,
    tagCounters: Record<string, number> | undefined
): void {
    if (!tagCounters) return;
    const counters: Record<string, number> = { ...(card.counters ?? {}) };
    for (const [type, count] of Object.entries(tagCounters)) {
        if (count <= 0) continue;
        counters[type] = (counters[type] ?? 0) + count;
    }
    if (Object.keys(counters).length > 0) card.counters = counters;
}

/** Runs CR 614 enters-the-battlefield replacements (issue #1148) — "If a
 *  nontoken creature would enter and it wasn't cast, exile it instead"
 *  (Containment Priest). Like `applyGraveyardBoundReplacements`, this event
 *  never fully cancels: a permanent that would enter always ends up
 *  somewhere, so a matching replacement rewrites `event.destination` to
 *  `"exile"` rather than returning `{kind:"consumed"}`. Always returns a
 *  non-null event; the `?? event` fallback only guards a replacement author
 *  misusing `"consumed"` on this event kind (a contract violation caught by
 *  validation/tests, not expected at runtime). */
export function applyEnterBattlefieldReplacements(
    state: GameState,
    event: EntersBattlefieldReplacementEvent
): EntersBattlefieldReplacementEvent {
    const result = applyReplacementsLoop(state, "enters-battlefield", event);
    return (result as EntersBattlefieldReplacementEvent | null) ?? event;
}

/** ADR 0100 D1 — what the CR 614 entry chokepoint answers. It used to answer
 *  "which zone"; it now answers "what happens next":
 *  - `"enter"` — nothing replaces the entry, the caller runs its entry tail;
 *  - `"exile"` — a CR 614 replacement redirected the permanent (Containment
 *    Priest); it never enters and the caller bins it;
 *  - `{ asEnters }` — the permanent owes one or more CR 614.1c / 614.12a
 *    "as it enters" choices, which must be answered BEFORE it enters. The
 *    caller parks it off every zone (`stageAsEntersEntry`) and returns; the
 *    entry resumes from the as-enters finalize (ADR 0100 D5). */
export type EntryVerdict =
    | "enter"
    | "exile"
    | { asEnters: readonly AsEntersChoice[] };

/** Convenience wrapper around `applyEnterBattlefieldReplacements` for the
 *  zone-change chokepoints (cast-resolution `finalizeSpellResolution`,
 *  reanimation/tutor/hand-cheat via `stageReanimatedOnBattlefield`, token
 *  creation via `createToken`) that only need the resolved verdict, not the
 *  full event shape.
 *
 *  ADR 0100 D1 — this function has EXACTLY THREE callers, one per census row
 *  A/B/C, and gains none: an entry path that skipped it would already miss the
 *  Containment Priest replacement (#1148), so the same invariant that keeps
 *  CR 614 honest keeps the as-enters choice point honest. The caller count is
 *  asserted structurally by
 *  `convex/gre/__tests__/entersBattlefieldReplacement.test.ts`.
 *
 *  `declaredEntersWith` lets a caller that holds the entering object's
 *  declaration directly (token creation, whose `TokenSpec` is not a printed
 *  `CardDefinition`) supply it; every other caller leaves it undefined and the
 *  clause is read off the definition the instance currently presents — which is
 *  the copied definition after a mid-resolution `becomeCopyOf` (CR 707.2).
 *  `asEntersResolved` is set by the RESUME path (`runStagedEntryTail`) so a
 *  re-entered entry tail does not park a second time on choices it has already
 *  answered. */
export function enterBattlefieldDestinationFor(
    state: GameState,
    card: {
        id: string;
        ownerId: string;
        types: ReadonlyArray<CardType>;
        card?: unknown;
    },
    controllerId: string,
    isToken: boolean,
    wasCast: boolean,
    opts?: {
        declaredEntersWith?: { asEnters?: AsEntersChoice[] };
        asEntersResolved?: boolean;
    }
): EntryVerdict {
    const result = applyEnterBattlefieldReplacements(state, {
        kind: "enters-battlefield",
        cardInstanceId: card.id,
        ownerId: card.ownerId,
        controllerId,
        isToken,
        wasCast,
        types: card.types,
        destination: "battlefield",
    });
    if (result.destination === "exile") return "exile";
    if (opts?.asEntersResolved) return "enter";
    // CR 614.1c — the "as it enters" clause is a copiable value read off the
    // definition the object PRESENTS (`card.card.id`), not off its printed
    // identity, so a Clone that copied during its own resolution owes the
    // copied card's choices (CR 707.2).
    const declared = opts?.declaredEntersWith?.asEnters;
    const presentedId = (card.card as { id?: string } | undefined)?.id;
    const fromDefinition = presentedId
        ? tryGetDefinition(presentedId)?.entersWith?.asEnters
        : undefined;
    const asEnters = declared ?? fromDefinition;
    if (asEnters && asEnters.length > 0) return { asEnters: [...asEnters] };
    return "enter";
}

/** Public helper for resolving a damage source's identity at the moment a
 *  damage event is emitted. Used by `dealDamage` and combat damage paths to
 *  populate `DamageReplacementEvent.sourceColors / sourceTypes /
 *  sourceStaticAbilities` so source-filtering replacements (Veteran
 *  Bodyguard's "except damage from sources with flying") can read them, and
 *  by `DAMAGE_DEALT` event emitters for last-known-information snapshots
 *  consumed by damage trigger factories (CR 603.10). */
/** CardDefinition id of Ghostly Flame (ICE). While it is on the battlefield,
 *  every black and/or red source of damage is treated as colourless for damage
 *  purposes (CR 119.4 / 614). The override is applied inside
 *  `describeDamageSource`, the single point every damage site reads source
 *  colours from. */
const GHOSTLY_FLAME_ID = "6314344b-6493-4142-9c76-da9b90b8d3e1";

/** True if any player controls Ghostly Flame (the colour override exists only
 *  while the enchantment does, CR 614). */
function hasGhostlyFlameInPlay(state: GameState): boolean {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if ((card.card as { id?: string }).id === GHOSTLY_FLAME_ID) {
                return true;
            }
        }
    }
    return false;
}

/** Applies Ghostly Flame's "black and/or red sources of damage are colourless"
 *  override (CR 614): a source whose colours include black or red becomes a
 *  colourless source of damage (empty colour set) while Ghostly Flame is in
 *  play. Other colours / colourless sources are unaffected. */
function applyGhostlyFlameColorOverride(
    state: GameState,
    colors: ReadonlyArray<Color>
): ReadonlyArray<Color> {
    if (colors.length === 0) return colors;
    if (!colors.includes("B") && !colors.includes("R")) return colors;
    if (!hasGhostlyFlameInPlay(state)) return colors;
    return [];
}

export function describeDamageSource(
    state: GameState,
    sourceInstanceId: string
): {
    colors: ReadonlyArray<Color>;
    types: ReadonlyArray<CardType>;
    subtypes: ReadonlyArray<string>;
    staticAbilities: ReadonlyArray<string>;
} {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.id !== sourceInstanceId) continue;
            const cardId = (card.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const rawColors = def?.manaCost
                ? getColorsFromCost(def.manaCost)
                : [];
            return {
                colors: applyGhostlyFlameColorOverride(state, rawColors),
                types: card.types,
                subtypes: card.subtypes,
                staticAbilities: card.staticAbilities,
            };
        }
    }
    const stackItem = state.stack.find((s) => s.id === sourceInstanceId);
    if (stackItem) {
        const cardId = (stackItem.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : null;
        const rawColors = def?.manaCost ? getColorsFromCost(def.manaCost) : [];
        return {
            colors: applyGhostlyFlameColorOverride(state, rawColors),
            types: stackItem.types,
            subtypes: stackItem.subtypes,
            staticAbilities: stackItem.staticAbilities,
        };
    }
    return { colors: [], types: [], subtypes: [], staticAbilities: [] };
}
