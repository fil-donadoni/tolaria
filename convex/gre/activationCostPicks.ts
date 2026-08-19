// Activation-cost PICKS (CR 602.1 / 118) — the concrete cards a player names to
// pay an activated ability's non-mana cost legs.
//
// Four of an ability's cost legs are deferred by the server: it parks a
// `pendingActivation` carrying an unanswered picker and refuses to commit until
// the activator names the cards (`game.ts`: `needsDiscardChoice` /
// `needsExileChoice` / `needsTapOtherChoice` are unconditional;
// `needsSacrificeChoice` whenever the board is not fungible).
//
//   `cost.discardFilter`      → `selectActivationDiscardCost`  (CR 118.3)
//   `cost.exileFromGraveyard` → `selectActivationExileCost`    (CR 118.5)
//   `cost.tapOtherFilter`     → `selectActivationCost`         (CR 118.8)
//   `cost.sacrificeFilter`    → `selectSacrifice`              (CR 701.21 / 118.5)
//
// The bot has to answer them exactly like a human does, so the picks are part of
// the `activate-ability` Move (`moves.ts`) rather than re-derived at each site:
// the search applies THE SAME cards the executor later names to the server. When
// they were derived independently the two disagreed silently; when they were
// derived nowhere at all the bot could not pay the cost, the server never
// committed, the abandoned payment rolled back (`rollbackPendingActivation`),
// and the identical position re-produced the identical move forever — the
// tap-a-land-then-untap-it loop Survival of the Fittest showed.
//
// This module is the single authority for BOTH the candidate ordering and the
// default plan; `moves.ts` enumerates the variants worth searching over,
// `applyMove.ts` applies whatever the Move carries, `executor.ts` submits it.
import type { ActivatedAbility } from "../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { getStaticAdditionalSacrifices } from "./state";
import type {
    SacrificeRequirement,
    SacrificeSelection,
} from "./sacrificeChoice";
import {
    buildSacrificeRequirements,
    autoResolveFungible,
    identityKey,
} from "./sacrificeChoice";
// The conservative pick primitives are SHARED with the live bot's reactive
// park answers (`gre/paymentPicks.ts`, ADR 0091 / issue #1209) — one
// implementation, so the search's plan and the bot's fallback can never drift.
import {
    cheapestFirst,
    completeSacrificeSelection,
    nextSacrificeCandidates,
} from "./paymentPicks";
import { getEffectivePower } from "./layers";
import { effectivePermanentView } from "./permanentView";
import { tryGetDefinition } from "../cards/index";
import { matchesPermanentFilter, resolveExcludeSource } from "../cards/filters";
import { liveSupertypesOf } from "./snow";
import { handCardMatchesFilter } from "./alternativeCost";
import {
    crewPowerContribution,
    isTapOtherSelectionComplete,
    pickTapOtherPayment,
} from "./tapOtherCost";

/** The cards named to pay one activation's deferred cost legs. Every field is
 *  absent when the ability has no such leg, so a Move for an ordinary
 *  tap-or-mana ability carries no `costPicks` at all. */
export type ActivationCostPicks = {
    /** CR 118.3 — hand cards discarded to pay `cost.discardFilter`. */
    discardIds?: string[];
    /** CR 118.5 — cards exiled from ONE graveyard to pay
     *  `cost.exileFromGraveyard` (the whole cost comes from a single
     *  graveyard, so the owner travels with the ids). */
    exileFromGraveyard?: {
        graveyardOwnerId: string;
        cardInstanceIds: string[];
    };
    /** CR 118.8 — other permanents tapped to pay `cost.tapOtherFilter`
     *  (Hand of Justice's fixed N, Crew N's power threshold). */
    tapOtherIds?: string[];
    /** CR 701.21 / 118.5 — permanents sacrificed to pay `cost.sacrificeFilter`
     *  (plus any static additional-sacrifice tax, CR 601.2f). Only the picks
     *  the payer must SUBMIT: a fungible board is auto-resolved server-side at
     *  announcement (`autoResolveFungible`), and those victims are already
     *  recorded, so re-naming them would be rejected. */
    sacrificeIds?: string[];
};

/** Hand cards that can pay `cost.discardFilter`, CHEAPEST FIRST (CR 118.3).
 *  Ascending mana value is the conservative default — the cheapest matching
 *  card is the least material given up — and it is also the order the search
 *  enumerates variants in, so the first variant reproduces the historical
 *  deterministic pick exactly. Ties break on instance id so the order is
 *  stable across runs (determinism is a hard requirement for the search). */
export function activationDiscardCandidates(
    player: PlayerState,
    ability: ActivatedAbility
): CardInstanceState[] {
    const leg = ability.cost.discardFilter;
    if (!leg) return [];
    return cheapestFirst(
        player.hand.filter((c) => handCardMatchesFilter(c, leg.filter))
    );
}

/** Untapped non-source permanents that can pay `cost.tapOtherFilter`
 *  (CR 118.8), with the crew power each contributes (CR 702.122a/b). */
function tapOtherCandidates(
    state: GameState,
    player: PlayerState,
    source: CardInstanceState,
    ability: ActivatedAbility
): { id: string; power: number }[] {
    const leg = ability.cost.tapOtherFilter;
    if (!leg) return [];
    return player.battlefield
        .filter(
            (c) =>
                c.id !== source.id &&
                !c.isTapped &&
                // The layered view (`gre/permanentView.ts`, CR 105.2 / 613),
                // matching the server's own candidate scan
                // (`tapOtherCandidates`, `game.ts`) and the legality check that
                // let the activation be announced. WITHOUT it a `colors`
                // filter — Hand of Justice's "three untapped WHITE creatures
                // you control" — matched nothing (a raw `CardInstanceState`
                // carries no `colors` field at all), so
                // `planActivationCostPicks` returned null and the enumerator
                // treated every coloured tap-other activation as illegal: dead
                // for the bot rather than stalling. Issue #1209.
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    leg.filter,
                    {
                        selfControllerId: player.id,
                        supertypesOf: liveSupertypesOf,
                    }
                )
        )
        .map((c) => ({
            id: c.id,
            power: crewPowerContribution(
                getEffectivePower(state, c),
                tryGetDefinition((c.card as { id?: string }).id ?? "")
                    ?.crewPowerBonus ?? 0
            ),
        }));
}

/** The graveyard that will pay `cost.exileFromGraveyard`, and the cards taken
 *  from it (CR 118.5 — the WHOLE cost comes from one graveyard). Prefers an
 *  OPPONENT's graveyard when the cost may be paid from any (Night Soil): the
 *  activator's own graveyard is a resource for its own recursion, an
 *  opponent's is one it wants gone anyway. `owner: "you"` (Grim Lavamancer)
 *  admits only the activator's own. */
function planExilePick(
    state: GameState,
    player: PlayerState,
    ability: ActivatedAbility
): ActivationCostPicks["exileFromGraveyard"] {
    const leg = ability.cost.exileFromGraveyard;
    if (!leg) return undefined;
    const sources =
        leg.owner === "you"
            ? [player]
            : [
                  ...state.players.filter((p) => p.id !== player.id),
                  ...state.players.filter((p) => p.id === player.id),
              ];
    for (const p of sources) {
        const matching = p.graveyard.filter(
            (c) => leg.cardType === undefined || c.types.includes(leg.cardType)
        );
        if (matching.length < leg.count) continue;
        // Cheapest first, mirroring the discard leg: the least valuable cards
        // in that graveyard pay the cost.
        const picked = cheapestFirst(matching).slice(0, leg.count);
        return {
            graveyardOwnerId: p.id,
            cardInstanceIds: picked.map((c) => c.id),
        };
    }
    return undefined;
}

/** The sacrifice selection an activation announces (CR 701.21 / 601.2f): the
 *  ability's own `sacrificeFilter` leg plus any static additional-sacrifice tax
 *  (Drought), already collapsed by `autoResolveFungible` where the board offers
 *  no real choice. Lives here rather than in `game.ts` because BOTH the server
 *  (at announcement) and the bot's move enumerator (deciding what it must
 *  submit, and whether a victim choice is worth searching) need the identical
 *  selection — the two disagreeing is exactly how the bot ends up naming a
 *  victim the server never asked for, or naming none when it did. */
export function buildActivationSacrificeSelection(
    state: GameState,
    ability: ActivatedAbility,
    source: CardInstanceState,
    player: PlayerState,
    reason: string
): SacrificeSelection | undefined {
    const specs: SacrificeRequirement[] = [];
    if (ability.cost.sacrificeFilter) {
        specs.push({
            // CR 109.2 (issue #2367) — "Sacrifice ANOTHER artifact". This is
            // the one point where the ability's STATIC, per-card filter becomes
            // per-ACTIVATION data: from here it is persisted on
            // `pendingActivation`, crosses the wire, and is re-read by
            // `sacrificeCandidates` / `autoResolveFungible` /
            // `isSacrificeCandidateLegal` / `legalActions` / the Brain / the
            // client's battlefield picker — none of which sees the source
            // again. Baking `excludeSource` into a concrete
            // `excludeInstanceIds` entry here makes all of them correct at
            // once; the matcher's fail-closed branch is what makes forgetting
            // it safe rather than permissive.
            filter: resolveExcludeSource(
                ability.cost.sacrificeFilter,
                source.id
            ),
            // CR 602.1 / 118.5 (issue #2398) — "Sacrifice TEN nonland
            // permanents" (Bolas's Citadel). Default 1: the single-permanent
            // shape every earlier card uses. The mana-value snapshot is taken
            // only for a count of 1 — "the sacrificed permanent" (Priest of
            // Yawgmoth's `getAdditionalSacrificeMv()`) names no single victim
            // above that, and `sacrificeSnapshotFromSelection` picks the first
            // flagged result, which would be an arbitrary one of ten.
            count: ability.cost.sacrificeFilterCount ?? 1,
            snapshot: (ability.cost.sacrificeFilterCount ?? 1) === 1,
        });
    }
    for (const req of getStaticAdditionalSacrifices(
        state,
        ability.cost.mana,
        source,
        "ability"
    )) {
        specs.push({ filter: req.filter, count: req.count });
    }
    const requirements = buildSacrificeRequirements(specs);
    if (requirements.length === 0) return undefined;
    const selection: SacrificeSelection = {
        playerId: player.id,
        reason,
        requirements,
        picked: [],
    };
    autoResolveFungible(state, selection);
    return selection;
}

/** The selection an activation of `ability` would announce, built with the same
 *  inputs the server uses. */
function activationSacrificeSelection(
    state: GameState,
    player: PlayerState,
    source: CardInstanceState,
    ability: ActivatedAbility
): SacrificeSelection | undefined {
    const def = tryGetDefinition((source.card as { id?: string }).id ?? "");
    return buildActivationSacrificeSelection(
        state,
        ability,
        source,
        player,
        def?.name ?? "Sacrifice"
    );
}

/** The default (conservative, fully deterministic) picks for every deferred
 *  cost leg the ability has. Returns `undefined` when the ability has no
 *  deferred leg, and `null` when a leg has no legal payment — the activation
 *  is then not a legal move at all (`enumerateMoves` gates on the same
 *  conditions the server does). */
export function planActivationCostPicks(
    state: GameState,
    player: PlayerState,
    source: CardInstanceState,
    ability: ActivatedAbility
): ActivationCostPicks | undefined | null {
    const { discardFilter, exileFromGraveyard, tapOtherFilter } = ability.cost;
    const sacSelection = activationSacrificeSelection(
        state,
        player,
        source,
        ability
    );
    if (
        !discardFilter &&
        !exileFromGraveyard &&
        !tapOtherFilter &&
        !sacSelection
    ) {
        return undefined;
    }
    const picks: ActivationCostPicks = {};

    if (sacSelection) {
        const submitted = completeSacrificeSelection(state, sacSelection);
        if (submitted === null) return null;
        if (submitted.length > 0) picks.sacrificeIds = submitted;
    }

    if (discardFilter) {
        const candidates = activationDiscardCandidates(player, ability);
        if (candidates.length < discardFilter.count) return null;
        picks.discardIds = candidates
            .slice(0, discardFilter.count)
            .map((c) => c.id);
    }
    if (exileFromGraveyard) {
        const plan = planExilePick(state, player, ability);
        if (!plan) return null;
        picks.exileFromGraveyard = plan;
    }
    if (tapOtherFilter) {
        const picked = pickTapOtherPayment(
            tapOtherFilter,
            tapOtherCandidates(state, player, source, ability)
        );
        // CR 602.5b — an unpayable leg makes the whole activation illegal.
        if (!isTapOtherSelectionComplete(tapOtherFilter, picked)) return null;
        picks.tapOtherIds = picked.map((c) => c.id);
    }
    return picks;
}

/** Every permanent that actually leaves the battlefield to pay the activation's
 *  sacrifice legs: the victims the server auto-resolved at announcement PLUS
 *  the ones the payer submits (`picks.sacrificeIds`). The search must apply
 *  both — `sacrificeIds` alone is the submission list, not the payment. */
export function activationSacrificeVictims(
    state: GameState,
    player: PlayerState,
    source: CardInstanceState,
    ability: ActivatedAbility,
    picks: ActivationCostPicks | undefined
): string[] {
    const sel = activationSacrificeSelection(state, player, source, ability);
    if (!sel) return [];
    const submitted = picks?.sacrificeIds ?? [];
    const victims = [...sel.picked];
    for (const id of submitted) {
        if (!victims.includes(id)) victims.push(id);
    }
    return victims;
}

/** How many VICTIM variants the enumerator may emit for one activation. WHICH
 *  card a tutor engine eats (Survival of the Fittest) or which creature a sac
 *  outlet swallows (Fallen Angel) is the decision the card is about, so that
 *  leg is searched rather than fixed — but the branching factor is capped, and
 *  indistinguishable candidates collapse to one variant. */
export const MAX_VICTIM_VARIANTS = 4;

/** Every pick-plan worth searching over for one activation, cheapest-discard
 *  first. The first entry is always {@link planActivationCostPicks}'s default,
 *  so a caller that takes only the head reproduces the deterministic policy.
 *  Empty when a leg has no legal payment. */
export function enumerateActivationCostPicks(
    state: GameState,
    player: PlayerState,
    source: CardInstanceState,
    ability: ActivatedAbility
): (ActivationCostPicks | undefined)[] {
    const base = planActivationCostPicks(state, player, source, ability);
    if (base === null) return [];
    if (base === undefined) return [undefined];

    // ONE leg varies per activation, never the cartesian product of two: the
    // discard leg when there is one, else the sacrifice leg. The exile and
    // tap-other legs never vary — they give up fungible resources (cards
    // already in a graveyard, an untapped body for one turn) and a second
    // variant would multiply the branching factor for a decision no evaluator
    // term can tell apart.
    const discard = ability.cost.discardFilter;
    if (discard && discard.count === 1) {
        const seen = new Set<string>();
        const variants: ActivationCostPicks[] = [];
        for (const card of activationDiscardCandidates(player, ability)) {
            // Two copies of the same card are the same decision (CR 400.7 —
            // identity is the card, not the instance).
            const key = (card.card as { id?: string }).id ?? card.id;
            if (seen.has(key)) continue;
            seen.add(key);
            variants.push({ ...base, discardIds: [card.id] });
            if (variants.length >= MAX_VICTIM_VARIANTS) break;
        }
        return variants.length > 0 ? variants : [base];
    }

    // CR 701.21 — the sacrifice victim, when the board leaves a real choice.
    // `base.sacrificeIds` is undefined when `autoResolveFungible` already
    // settled the whole selection server-side, and a multi-victim payment
    // (a Drought tax on top of the ability's own leg) keeps the deterministic
    // cheapest-first plan rather than enumerating combinations.
    if (base.sacrificeIds?.length === 1) {
        const sel = activationSacrificeSelection(
            state,
            player,
            source,
            ability
        );
        if (!sel) return [base];
        const seen = new Set<string>();
        const variants: ActivationCostPicks[] = [];
        for (const victim of nextSacrificeCandidates(state, sel)) {
            // Same fungibility notion the server's auto-resolve uses, so the
            // two agree on what counts as the same decision.
            const key = identityKey(state, victim);
            if (seen.has(key)) continue;
            seen.add(key);
            const trial: SacrificeSelection = {
                ...sel,
                picked: [...sel.picked],
            };
            const submitted = completeSacrificeSelection(state, trial, victim);
            if (submitted === null) continue;
            variants.push({ ...base, sacrificeIds: submitted });
            if (variants.length >= MAX_VICTIM_VARIANTS) break;
        }
        return variants.length > 0 ? variants : [base];
    }

    return [base];
}
