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
    applySacrificeSelection,
    autoResolveFungible,
    buildSacrificeRequirements,
    type SacrificeRequirement,
    type SacrificeSelection,
} from "./sacrificeChoice";
import {
    castExileViewFor,
    cheapestFirst,
    chooseCastExileCost,
    completeSacrificeSelection,
} from "./paymentPicks";
import { buildCastExileCostChoice, type CastFromZone } from "./castCost";
import { getFlashbackAdditionalCost } from "./flashback";
import { hasEscape } from "./escape";
import { matchesPermanentFilter } from "../cards/filters";
import { effectivePermanentView } from "./permanentView";
import type { AdditionalCostSpec, CardDefinition } from "../cards/types";
import type { PermanentFilter } from "../cards/filters";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "./state";

/** The cost-victim snapshot a cast's stack item carries (CR 118.8 / 608.2h),
 *  named once here so both search sandboxes stamp the same shape the mutation
 *  path does. */
type AdditionalSacrificeSnapshot = NonNullable<
    StackItem["additionalSacrificeSnapshot"]
>;

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
    /** CR 702.138a escape / 702.34a flashback / 118.8 — the cards exiled to pay a
     *  GRAVEYARD cast's non-mana exile cost: escape's "exile N other cards from
     *  your graveyard" (Uro, Phlage, and everything Underworld Breach grants
     *  escape to), Flash of Insight's `flashbackExileFromGraveyard`, or the
     *  flashback-only "exile a card from your HAND" leg. All three park on the
     *  ONE `PendingCast.exileFromGraveyardChoice` slot and submit through the
     *  ONE `selectCastExileCost` mutation, so they share one field here; the
     *  source zone is re-derived from the same builder wherever it matters.
     *
     *  Charging this in the search sandboxes is not an accuracy nicety, it is
     *  what BOUNDS the line: escape (unlike flashback, CR 702.34a) exiles
     *  nothing on resolution, so an escaped card returns to the graveyard and
     *  is escapable again — exactly the unbounded-recast shape the retrace land
     *  discard exists to bound. A sandbox that skipped the exile would model an
     *  escape creature as infinitely recurring. */
    exileCostCardIds?: string[];
};

/** GRE mirror of `game.ts`'s `buildCastSacrificeSelection` (issue #2135): the
 *  cast's filtered-sacrifice selection — the card's OWN `additionalCosts
 *  .sacrificeFilter` (after the caster-chosen `oneOf` leg is flattened, CR
 *  601.2b), the flashback-only "Sacrifice a <filter>" cost on a GRAVEYARD cast
 *  (CR 702.34a flashback / 118.8 — Lava Dart's "Sacrifice a Mountain"), and
 *  every board-wide static additional sacrifice (Drought, CR 118.8) — plus its
 *  exile additional-cost filter. This lives in the GRE because `game.ts` is the
 *  mutation SURFACE (ADR 0074), not a library the engine's own move-generation
 *  and search sandboxes depend on.
 *
 *  Requirement ORDER matches `buildCastSacrificeSelection` line for line — own
 *  filter, then the flashback leg, then the statics — because
 *  `completeSacrificeSelection` walks the requirements in order and takes the
 *  cheapest still-unused match for each: a different order names different
 *  victims, and the whole point of the pick riding on the Move is that the
 *  search charges exactly what the server accepts. */
export function buildCastCostSelection(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    additionalCosts: AdditionalCostSpec | undefined,
    reason: string,
    /** CR 601.3 / 702.34 — the zone this cast leaves. Only a `"graveyard"` cast
     *  owes the flashback sacrifice leg, so the cost never leaks onto the hand
     *  cast of the same card. Defaults to `"hand"`, which is what every
     *  pre-#2980 caller meant. */
    castFromZone: CastFromZone = "hand"
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
    // CR 702.34a / 118.8 — the flashback-only "Sacrifice a <filter>" cost (Lava
    // Dart), owed ONLY on a FLASHBACK cast. Exactly one permanent, and NOT
    // snapshot-flagged: the flashback resolution reads no sacrificed-permanent
    // data. Mirrors `buildCastSacrificeSelection`'s own branch exactly.
    //
    // The zone alone does not decide it — `hasEscape` does, in the SAME
    // precedence `castRawManaCost` and `graveyardCastStackFlags` use (CR
    // 702.138 escape beats CR 702.34 flashback). Underworld Breach grants
    // escape to EVERY nonland card in its controller's graveyard, Lava Dart
    // included, and a Breach-granted escape cast of Lava Dart owes the escape
    // cost — never the flashback one. Charging both made the search tap a
    // Mountain for the escape's {R} and sacrifice that same Mountain in the
    // same move (measured, issue #2980).
    if (castFromZone === "graveyard" && !hasEscape(state, card)) {
        const fbSacrifice = getFlashbackAdditionalCost(card)?.sacrifice;
        if (fbSacrifice) specs.push({ filter: fbSacrifice, count: 1 });
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

/** Pay a cast's sacrifice legs on a SEARCH SANDBOX state: every permanent that
 *  actually leaves the battlefield — the victims the server auto-resolved at
 *  announcement PLUS the ones the payer submits (`picks.sacrificeIds`); the
 *  search must apply both, since `sacrificeIds` alone is the submission list,
 *  not the payment.
 *
 *  Returns the snapshot-flagged victim's `additionalSacrificeSnapshot` (CR
 *  118.8 / 608.2h), which the caller stamps onto the pushed stack item exactly
 *  as the mutation path does (`sacrificeSnapshotFromSelection`, `game.ts`).
 *  Without it every card whose resolution reads the victim back —
 *  `SpellContext.getAdditionalSacrificeMv` / `getAdditionalCostSubtypes`
 *  (Metamorphosis, Sacrifice, Burnt Offering, Bone Shards' subtype read) —
 *  resolved for NOTHING inside the tree: the search paid a creature and a card
 *  for a blank, so it could never find the ritual line, and (the reported
 *  symptom) a rollout that washes the material loss out could still pick the
 *  cast on visits.
 *
 *  The removal itself goes through `applySacrificeSelection`, the SAME
 *  authority the three mutation commit sites use, so the sandbox and the
 *  server can never drift on which victim is snapshot-flagged. */
export function applyCastSacrificeVictims(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    additionalCosts: AdditionalCostSpec | undefined,
    picks: CastCostPicks | undefined,
    reason: string,
    castFromZone: CastFromZone = "hand"
): AdditionalSacrificeSnapshot | undefined {
    const { selection } = buildCastCostSelection(
        state,
        player,
        card,
        additionalCosts,
        reason,
        castFromZone
    );
    if (!selection) return undefined;
    const submitted = picks?.sacrificeIds ?? [];
    const picked = [...selection.picked];
    for (const id of submitted) {
        if (!picked.includes(id)) picked.push(id);
    }
    const results = applySacrificeSelection(state, { ...selection, picked });
    const snap = results.find((r) => r.snapshot);
    if (!snap) return undefined;
    return {
        cardInstanceId: snap.id,
        mv: snap.mv,
        ...(snap.subtypes ? { subtypes: snap.subtypes } : {}),
        ...(snap.power !== undefined ? { power: snap.power } : {}),
    };
}

/** The deterministic (K=1) picks for every mandatory additional-cost park a
 *  cast of `card` owes: the cheapest-first sacrifice victims (CR 701.21 — the
 *  card's own filter, the flashback "Sacrifice a <filter>" leg on a graveyard
 *  cast, and Drought's static tax), the cheapest matching permanent for the
 *  exile leg (CR 701.13, Soul Exchange), and the cards exiled for a graveyard
 *  cast's non-mana exile cost (CR 702.138a escape / CR 702.34a flashback).
 *  `undefined` when the cast owes no such park. `null` when a leg has no legal
 *  payment — the cast is then not a legal move at all.
 *
 *  For the escape / flashback exile leg this `null` is DEFENCE IN DEPTH, not
 *  the only gate: `getLegalActions` already refuses "cast" for a graveyard too
 *  thin to pay (`hasPayableEscapeExileCost` / `hasPayableFlashbackAdditionalCost`,
 *  `gre/rules.ts`), and breaking either one alone leaves the Move correctly
 *  suppressed — it takes breaking BOTH to make the enumerator offer a cast the
 *  announcement throws on (measured, issue #2980 proof-of-failure). The one
 *  shape this gate answers ALONE is the X-dependent `flashbackExileFromGraveyard`
 *  cost, whose X the affordability gate cannot see: it runs before announcement.
 *
 *  `chosenLegId` names the caster-chosen `oneOf` leg (`additionalCostLegId`),
 *  flattened through `resolveAdditionalCosts` so a `oneOf` leg carrying a
 *  sacrifice/exile filter is priced exactly as `announceCast` prices it.
 *
 *  The returned ids are exactly what `executor.ts` names to `selectSacrifice` /
 *  `selectAdditionalCost` / `selectCastExileCost`, and what both search
 *  sandboxes remove — so the search, the greedy sandbox and the live bot can
 *  never drift. */
export function planCastCostPicks(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    def: CardDefinition | undefined,
    chosenLegId: string | undefined,
    /** CR 601.3 (issue #2980) — the zone this cast leaves and, for the
     *  X-dependent `flashbackExileFromGraveyard` cost, the X it announces.
     *  Omitted = a hand cast, which owes neither of the graveyard legs. */
    opts?: { castFromZone?: CastFromZone; chosenX?: number }
): CastCostPicks | undefined | null {
    const castFromZone = opts?.castFromZone ?? "hand";
    const spec = resolveAdditionalCosts(def?.additionalCosts, chosenLegId);
    const { selection, exileFilter } = buildCastCostSelection(
        state,
        player,
        card,
        spec,
        def?.name ?? "Sacrifice",
        castFromZone
    );
    const picks: CastCostPicks = {};
    // A sacrifice park the server auto-resolves at announcement (a fungible /
    // forced board) still costs the search a victim — `sacrificeIds` only ever
    // names the picks the payer must SUBMIT, so a fully-auto-resolved selection
    // leaves it empty. Track owed-ness separately so the Move still carries the
    // park and `applyCastCostPicksForSearch` removes the auto-resolved victim
    // via `applyCastSacrificeVictims`.
    let owesSacrifice = false;

    if (selection) {
        owesSacrifice = true;
        const submitted = completeSacrificeSelection(state, selection);
        if (submitted === null) return null;
        if (submitted.length > 0) picks.sacrificeIds = submitted;
    }

    if (exileFilter) {
        // CR 701.13 / 105.2 — the layered view, so a `colors` filter reads the
        // effective colour. Same matcher options the server's own
        // `buildAdditionalCostPicker` and the live fallback
        // (`paymentPicks.ts`'s `cast:additionalCost`) use — `selfControllerId`
        // only, NO `supertypesOf` — so the search names exactly the victim they
        // accept and the two can never diverge.
        const candidates = cheapestFirst(
            player.battlefield.filter((c) =>
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    exileFilter,
                    {
                        selfControllerId: player.id,
                    }
                )
            )
        );
        const pick = candidates[0];
        if (!pick) return null;
        picks.additionalCostCardId = pick.id;
    }

    // CR 702.138a escape / 702.34a flashback / 118.8 — the graveyard cast's
    // the SAME builder the announcement parks on (`buildCastExileCostChoice`,
    // `gre/castCost.ts`) and the SAME deterministic answer the live reactive
    // fallback submits for that park (`chooseCastExileCost` over
    // `castExileViewFor`, `gre/paymentPicks.ts`). Two shared authorities rather
    // than a third private pick, so the ids the search charges, the ids the
    // executor names, and the ids `pickForOwedPayment` would have chosen are
    // one and the same list.
    const exileBuild = buildCastExileCostChoice(
        state,
        player,
        card,
        castFromZone,
        { additionalCosts: spec, chosenX: opts?.chosenX }
    );
    if (exileBuild) {
        // Not enough fodder in the graveyard / hand: the cast is unpayable, so
        // fail CLOSED rather than offer a Move whose announcement throws.
        if ("unpayable" in exileBuild) return null;
        // `exileBuild.choice` is defined here, so the view never comes back
        // null (`castExileViewFor` only nulls on an absent picker).
        const view = castExileViewFor(player, exileBuild.choice)!;
        const ids = chooseCastExileCost(view);
        // CR 702.138a — the VARIABLE escape cost (Nethergoyf) is satisfied by
        // COVERAGE, not by count: `view.required` is the whole candidate list
        // for that shape, while the answer is a minimal type-covering subset,
        // so a count comparison would reject every legal payment. The build
        // above already refused an unpayable board (`unpayable`), and
        // `chooseCastExileCost` falls back to the full list when no subset
        // reaches the threshold.
        if (view.typeCover === undefined && ids.length < view.required) {
            return null;
        }
        picks.exileCostCardIds = ids;
    }

    if (
        !owesSacrifice &&
        !picks.additionalCostCardId &&
        !picks.exileCostCardIds
    ) {
        return undefined;
    }
    return picks;
}
