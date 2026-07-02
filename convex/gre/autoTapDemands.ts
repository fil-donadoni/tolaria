import { getInstanceManaCost, tryGetDefinition } from "../cards";
import type { Demand } from "./autoTap";
import { abilitiesSuppressed, hasInstantSpeed } from "./constants";
import type { Phase } from "./types";
import type { CardInstanceState } from "./state";
import { normalizeManaCost } from "./state";

/**
 * Build the **hand-spell Demands** for smart auto-tap (PRD #472, ADR 0034,
 * issue #474 — the spine).
 *
 * A Demand here is *another* spell in the paying player's hand whose mana cost
 * the solver tries not to strand when it auto-taps for the spell being cast.
 * This is the demand-aware spine: it enumerates every castable-shaped hand
 * card other than the one currently being paid for, carrying its normalized
 * mana cost. The auto-tap scorer (`scorePreservedDemands`) then measures, for
 * each candidate tap plan, how many of these stay individually affordable
 * after the payment.
 *
 * **Timing filter (issue #475, CR 307 / 601.3a / 602 / 603).** A hand spell is
 * a preservable Demand only when it is legal to *cast at the current timing*:
 *  - Instant-speed spells (Instants and Flash cards, CR 702.8) can be cast in
 *    any priority window, including the opponent's turn — they always count.
 *  - Sorcery-speed spells (creatures, sorceries, and any non-flash permanent)
 *    may be cast only when the player could cast a sorcery (CR 307.1 / 601.3a):
 *    their own main phase, empty stack, holding priority. They count only when
 *    `isSorceryTiming` is true. Off-turn / instant-window payments do NOT
 *    preserve mana for them — auto-tap must not hoard mana for plays the player
 *    cannot legally make right now (PRD #472 user stories 4 & 5).
 *
 * `isSorceryTiming` is computed by the caller via the engine's existing
 * `isSorceryTiming(state)` helper (`phases.ts`) — the timing condition is never
 * re-derived here. Instant-speed legality is the canonical `hasInstantSpeed`
 * predicate (`constants.ts`).
 *
 * Scope of this slice (deliberately narrow — siblings layer on top):
 *  - Lands are skipped (they aren't cast and have no mana cost).
 *  - Cards with no mana cost (can't strand mana) are skipped.
 *  - The card being cast (`excludeInstanceId`) is excluded — it's the payment
 *    target, not a Demand.
 *
 * **X-spells assumed at X=1 (issue #477, CR 107.3 / 601.2b).** A variable-X
 * spell ({X}{R} Fireball, {X}{U} Power Sink) is folded into the Demand set at
 * an assumed **X=1** — its preserve-cost is the base cost plus one generic per
 * `{X}` pip (`xFactor`: {X}{X}{U} → X=1 contributes 2 generic). X=0 would
 * under-preserve and strand the spell: on any turn the player actually casts an
 * X-spell, at least one mana goes to X, so reserving for X=1 is the minimum
 * meaningful demand. This is achieved by handing `chosenX: 1` to
 * `normalizeManaCost`, which (CR 107.3) only folds the chosen X into the generic
 * portion when the cost's `X` is the *variable* `"X"`; a fixed-number X (plain
 * generic) is untouched. Downstream affordability still decides whether X=1 is
 * actually payable from leftover sources — an X-spell unaffordable even at X=1
 * is simply not preserved (no false preservation).
 *
 * Demand affordability *before* and *after* payment is decided downstream in
 * `solveSmartAutoTap` against the real untapped sources + floating mana — this
 * helper only assembles the candidate cost list, deterministically in hand
 * order.
 */
export function buildHandSpellDemands(
    hand: CardInstanceState[],
    excludeInstanceId: string,
    isSorceryTiming: boolean
): Demand[] {
    const demands: Demand[] = [];
    for (const card of hand) {
        if (card.id === excludeInstanceId) continue;
        // Lands aren't cast (CR 305.1) — no mana cost to preserve for.
        if (card.types.includes("Land")) continue;
        // Timing filter (CR 307.1 / 601.3a): a sorcery-speed spell is a
        // preservable Demand only at sorcery timing; instant-speed spells
        // (Instant / Flash, CR 702.8) count in any priority window.
        if (!hasInstantSpeed(card) && !isSorceryTiming) continue;
        const rawCost = getInstanceManaCost(card);
        if (!rawCost) continue;
        // X-spell inflation (issue #477, CR 107.3 / 601.2b): assume X=1 so a
        // variable-X spell ({X}{R}) is preserved as base + one generic per `{X}`
        // pip. `chosenX` is a no-op for fixed (already-generic) costs — it only
        // folds into the generic portion when the printed `X` is the variable
        // `"X"`, matching how the engine resolves an announced X.
        const cost = normalizeManaCost(rawCost, { chosenX: 1 });
        // A free (no-mana) spell can never be stranded by auto-tap.
        if (Object.keys(cost).length === 0) continue;
        demands.push({ id: card.id, cost });
    }
    return demands;
}

/**
 * Build the **on-board-ability Demands** for smart auto-tap (PRD #472, ADR
 * 0034, issue #476).
 *
 * In addition to hand spells (`buildHandSpellDemands`), the active player's
 * already-resolved permanents may carry activated abilities that cost mana —
 * a firebreathing creature's `{R}: +1/+0` (CR 602.1, an activated ability of
 * the form *cost: effect*). Each such ability is another play the player might
 * still pay for this turn, so the solver tries not to strand its mana cost.
 *
 * **Counted once (PRD user story 12).** A repeatable ability ("activate any
 * number of times") is emitted as exactly *one* Demand per (permanent,
 * ability) pair — the question is "can I still activate it at least once?",
 * not "can I activate it N times?". A firebreathing creature therefore
 * contributes a single {R} Demand, not one per potential pump, so it does not
 * over-weight the scorer. Two distinct firebreathing creatures are two
 * distinct plays → two Demands (one each), which is correct.
 *
 * **What counts (CR 602.1).** Only abilities that:
 *  - actually carry a mana cost (`cost.mana`, non-empty after normalization) —
 *    an ability with no mana cost can never have its mana stranded;
 *  - are NOT mana abilities (`useStack: false` with a mana output) — those
 *    *produce* mana and are auto-tap *sources*, not Demands, and are already
 *    modeled by `buildAutoTapSources`.
 * Suppressed permanents (CR 613.1f — Humility / Blood Moon) expose none of
 * their printed activated abilities and are skipped.
 *
 * **Timing filter (issue #475, CR 602.5b).** An activated ability is a
 * preservable Demand only when it is legal to activate at the current timing,
 * checked per ability against the live timing facts:
 *  - By default activated abilities are instant-speed (CR 602.5b — any time you
 *    have priority), so they count in any window the auto-tap runs in.
 *  - `controllerTurnOnly` ("Activate only during your turn") counts only on the
 *    paying player's own turn (`isControllersTurn`).
 *  - `activationPhaseRestriction` ("Activate only during combat", Jade Statue)
 *    counts only while the current `phase` is in that list. This is what makes
 *    a combat-only ability *not* held for during a main phase even though it is
 *    its controller's turn.
 * The two restrictions compose (an ability with both must satisfy both). This
 * mirrors the hand-spell timing filter so auto-tap never hoards mana for a
 * play the player cannot legally make right now (PRD user stories 5 & 17).
 *
 * X in a cost is treated as 0 here (`normalizeManaCost` default), matching the
 * hand-spell helper; X-cost ability inflation is out of scope for this slice
 * (issue #477 handles X-spells).
 *
 * Demand affordability *before* and *after* payment is decided downstream in
 * `solveSmartAutoTap` — this helper only assembles the candidate cost list,
 * deterministically in battlefield order then ability order. The Demand `id`
 * is `${permanentId}#${abilityId}` so two abilities on one permanent (and the
 * same ability across permanents) stay distinct for debugging.
 */
export function buildBoardAbilityDemands(
    battlefield: CardInstanceState[],
    timing: { phase: Phase; isControllersTurn: boolean }
): Demand[] {
    const demands: Demand[] = [];
    for (const perm of battlefield) {
        // CR 613.1f — a permanent that has lost all abilities exposes none of
        // its printed activated abilities.
        if (abilitiesSuppressed(perm)) continue;
        const cardId = (perm.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        if (!def?.activatedAbilities) continue;
        for (const ability of def.activatedAbilities) {
            // Mana abilities (CR 605.1a) PRODUCE mana — they're sources, not
            // Demands (handled by `buildAutoTapSources`).
            if (!ability.useStack && ability.manaProduced) continue;
            if (!ability.cost.mana) continue;
            // Timing filter (CR 602.5b, issue #475): only count abilities legal
            // to activate at the current timing.
            if (
                ability.controllerTurnOnly === true &&
                !timing.isControllersTurn
            )
                continue;
            if (
                ability.activationPhaseRestriction &&
                ability.activationPhaseRestriction.length > 0 &&
                !ability.activationPhaseRestriction.includes(timing.phase)
            ) {
                continue;
            }
            const cost = normalizeManaCost(ability.cost.mana);
            // A free (no-mana) ability can never be stranded by auto-tap.
            if (Object.keys(cost).length === 0) continue;
            // Counted once per (permanent, ability) — repeatable activations do
            // NOT multiply the Demand (PRD user story 12).
            demands.push({ id: `${perm.id}#${ability.id}`, cost });
        }
    }
    return demands;
}
