// Cast-side mandatory park picks (ADR 0091, issue #2135) — the concrete cards a
// player names to pay a CAST's mandatory additional-cost parks, carried ON the
// `cast-spell` Move the same way the activation side already carries
// `costPicks` (`activationCostPicks.ts`).
//
// The activation side won its picks first (issue #1209 / #2155 / #2297); the
// cast side never did. A cast whose card declares `additionalCosts
// .sacrificeFilter` (Natural Order's "sacrifice a green creature",
// `pls/black.ts`, `arn/green.ts`, `fem/red.ts`) or `additionalCosts.exileFilter`
// (Soul Exchange, `fem/black.ts`), or one subject to a board-wide static
// additional sacrifice (Drought, CR 118.8) parks a `pendingCast` at announcement
// and blocks commit until the caster names the victim. The search sandboxes
// (`applyMoveForSearch` / `applyMoveInSearch`) charged NOTHING for those parks —
// a spell that must sacrifice a creature to cast was valued as if the sacrifice
// were free — while the live bot answered them reactively through
// `pickForOwedPayment` (`paymentPicks.ts`), cheapest-first.
//
// K=1 for every cast-side park (ADR 0091 decision 4, issue #2135): the pick is
// fungible, so the conservative cheapest-first victim is carried on the move and
// the search applies exactly what the executor later submits. The one
// "all-payable-legs" axis on the cast side is the CASTER-CHOSEN `oneOf`
// disjunction (`additionalCostLegId`), already shipped as its own axis of the
// `announceVariants` cross-product (`moves.ts` `legVariants`) and charged by
// `applyAdditionalCostLegForSearch` — that is NOT a park, so it does not appear
// here.
//
// Because every cast-side park is K=1, this module has no variant enumerator:
// `planCastCostPicks` returns the single deterministic plan, and `moves.ts`
// attaches it to every cast move. The per-kind K table that documents this (and
// delimits the kicker optional-cost axis, `gre/kicker.ts`, and the activation
// victim axis, `gre/activationCostPicks.ts`) lives in `gre/parkKinds.ts`.

import { resolveAdditionalCosts } from "./additionalCost";
import { getStaticAdditionalSacrifices } from "./state";
import { getInstanceManaCost } from "../cards";
import {
    autoResolveFungible,
    buildSacrificeRequirements,
    type SacrificeRequirement,
    type SacrificeSelection,
} from "./sacrificeChoice";
import { cheapestFirst, completeSacrificeSelection } from "./paymentPicks";
import { matchesPermanentFilter } from "../cards/filters";
import { effectivePermanentView } from "./permanentView";
import { liveSupertypesOf } from "./snow";
import type { AdditionalCostSpec, CardDefinition } from "../cards/types";
import type { PermanentFilter } from "../cards/filters";
import type { CardInstanceState, GameState, PlayerState } from "./state";

/** The cards named to pay one cast's mandatory additional-cost parks. Every
 *  field is absent when the cast has no such park, so a Move for an ordinary
 *  cast carries no `castCostPicks` at all. */
export type CastCostPicks = {
    /** CR 701.21 / 118.5 — permanents sacrificed to pay `additionalCosts
     *  .sacrificeFilter` (plus any static additional-sacrifice tax, CR 601.2f).
     *  Only the picks the payer must SUBMIT: a fungible board is auto-resolved
     *  server-side at announcement (`autoResolveFungible`), and those victims
     *  are already recorded, so re-naming them would be rejected. */
    sacrificeIds?: string[];
    /** CR 701.13 / 118.8 — the single permanent exiled to pay `additionalCosts
     *  .exileFilter` (Soul Exchange). */
    additionalCostCardId?: string;
};

/** GRE mirror of `game.ts`'s `buildCastSacrificeSelection` (issue #2135): the
 *  cast's filtered-sacrifice selection — the card's OWN `additionalCosts
 *  .sacrificeFilter` (after the caster-chosen `oneOf` leg is flattened, CR
 *  601.2b) plus every board-wide static additional sacrifice (Drought, CR
 *  118.8) — and its exile additional-cost filter. The flashback-only
 *  "Sacrifice a <filter>" cost is deliberately NOT modelled here: the bot
 *  enumerator emits no flashback cast at all
 *  (`docs/findings/2358-graveyard-cast-moves.md`), so no call site can reach a
 *  graveyard cast. This lives in the GRE because `game.ts` is the mutation
 *  SURFACE (ADR 0074), not a library the engine's own move-generation and
 *  search sandboxes depend on. */
export function buildCastCostSelection(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    additionalCosts: AdditionalCostSpec | undefined,
    reason: string
): {
    selection?: SacrificeSelection;
    exileFilter?: PermanentFilter;
} {
    const specs: SacrificeRequirement[] = [];
    if (additionalCosts?.sacrificeFilter) {
        specs.push({
            filter: additionalCosts.sacrificeFilter,
            count: 1,
            snapshot: true,
        });
    }
    // CR 601.2f / 118.5 — the board-wide static additional sacrifice (Drought),
    // per effect, per colour symbol in the PRINTED mana cost.
    for (const req of getStaticAdditionalSacrifices(
        state,
        getInstanceManaCost(card),
        card,
        "spell"
    )) {
        specs.push({ filter: req.filter, count: req.count });
    }
    const requirements = buildSacrificeRequirements(specs);
    let selection: SacrificeSelection | undefined;
    if (requirements.length > 0) {
        selection = { playerId: player.id, reason, requirements, picked: [] };
        autoResolveFungible(state, selection);
    }
    return {
        ...(selection ? { selection } : {}),
        ...(additionalCosts?.exileFilter
            ? { exileFilter: additionalCosts.exileFilter }
            : {}),
    };
}

/** Every permanent that actually leaves the battlefield to pay the cast's
 *  sacrifice legs: the victims the server auto-resolved at announcement PLUS
 *  the ones the payer submits (`picks.sacrificeIds`). The search must apply
 *  both — `sacrificeIds` alone is the submission list, not the payment. */
export function castSacrificeVictims(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    additionalCosts: AdditionalCostSpec | undefined,
    picks: CastCostPicks | undefined,
    reason: string
): string[] {
    const { selection } = buildCastCostSelection(
        state,
        player,
        card,
        additionalCosts,
        reason
    );
    if (!selection) return [];
    const submitted = picks?.sacrificeIds ?? [];
    const victims = [...selection.picked];
    for (const id of submitted) {
        if (!victims.includes(id)) victims.push(id);
    }
    return victims;
}

/** The deterministic (K=1) picks for every mandatory additional-cost park a
 *  cast of `card` owes: the cheapest-first sacrifice victims (CR 701.21) and
 *  the cheapest matching permanent for the exile leg (CR 701.13, Soul
 *  Exchange). `undefined` when the cast owes no such park. `null` when a leg
 *  has no legal payment — the cast is then not a legal move at all, though the
 *  enumerator's gate (`getLegalActions` → `hasPayableAdditionalCost`) already
 *  drops it first.
 *
 *  `chosenLegId` names the caster-chosen `oneOf` leg (`additionalCostLegId`),
 *  flattened through `resolveAdditionalCosts` so a `oneOf` leg carrying a
 *  sacrifice/exile filter is priced exactly as `announceCast` prices it.
 *
 *  The returned ids are exactly what `executor.ts` names to `selectSacrifice` /
 *  `selectAdditionalCost`, and what both search sandboxes remove — so the
 *  search, the greedy sandbox and the live bot can never drift. */
export function planCastCostPicks(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    def: CardDefinition | undefined,
    chosenLegId: string | undefined
): CastCostPicks | undefined | null {
    const spec = resolveAdditionalCosts(def?.additionalCosts, chosenLegId);
    const { selection, exileFilter } = buildCastCostSelection(
        state,
        player,
        card,
        spec,
        def?.name ?? "Sacrifice"
    );
    const picks: CastCostPicks = {};
    // A sacrifice park the server auto-resolves at announcement (a fungible /
    // forced board) still costs the search a victim — `sacrificeIds` only ever
    // names the picks the payer must SUBMIT, so a fully-auto-resolved selection
    // leaves it empty. Track owed-ness separately so the Move still carries the
    // park and `applyCastCostPicksForSearch` removes the auto-resolved victim
    // via `castSacrificeVictims`.
    let owesSacrifice = false;

    if (selection) {
        owesSacrifice = true;
        const submitted = completeSacrificeSelection(state, selection);
        if (submitted === null) return null;
        if (submitted.length > 0) picks.sacrificeIds = submitted;
    }

    if (exileFilter) {
        // CR 701.13 / 105.2 — the layered view, so a `colors` filter reads the
        // effective colour (mirrors `buildAdditionalCostPicker` in game.ts).
        const candidates = cheapestFirst(
            player.battlefield.filter((c) =>
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    exileFilter,
                    {
                        selfControllerId: player.id,
                        supertypesOf: liveSupertypesOf,
                    }
                )
            )
        );
        const pick = candidates[0];
        if (!pick) return null;
        picks.additionalCostCardId = pick.id;
    }

    if (!owesSacrifice && !picks.additionalCostCardId) return undefined;
    return picks;
}
