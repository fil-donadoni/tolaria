// Conservative PAYMENT PICKS (ADR 0091, issue #1209) — given an owed payment
// park (`nextOwedPayment`, `gre/owedPayment.ts`), the concrete submission that
// pays it.
//
// This is the answer half of the owed-payment seam. `nextOwedPayment` says WHAT
// is owed; {@link pickForOwedPayment} says WITH WHAT, as a
// {@link OwedPaymentSubmission} naming the exact human mutation the payer would
// call and the exact ids it would pass. No new bot-only entry point into cost
// legality: the bot submits through the same `select*` mutations a human's
// clicks drive, one pick per call (ADR 0091 decision 5).
//
// Two properties are load-bearing:
//
//  - **Exhaustive over {@link ParkKind}.** The switch is `assertNever`-closed,
//    so a park added to the census in `owedPayment.ts` cannot compile until it
//    has a pick here. That is the structural half of "adding a park costs one
//    classification and one pick function"; the census is the other half.
//  - **Conservative and deterministic.** Cheapest-first everywhere, ties broken
//    on instance id. The point is never to pick WELL — it is to pick the same
//    way twice and to always pick something the server accepts. A pick the
//    server rejects is a retry loop; a pick that differs from the simulated one
//    makes the evaluation that selected the move a lie (ADR 0091, alternatives).
//
// Callers: BOTH search sandboxes reach the activation legs through
// `activationCostPicks.ts` (which shares this module's sacrifice helpers) —
// `applyMoveForSearch` and `applyMoveInSearch` call the one shared
// `applyActivationCostsForSearch` (`applyMove.ts`, issue #2155), so the greedy
// 1-ply leaf and the ISMCTS tree pay the same cards. The live bot answers any
// owed park through `pickForOwedPayment`. Three callers, one set of picks.

import { tryGetDefinition } from "../cards/index";
import { matchesPermanentFilter } from "../cards/filters";
import { isExileCostEligible } from "../cards/exileCostEligibility";
import { manaValue } from "./constants";
import { STATIC_EFFECT_CTX } from "./layers";
import { effectivePermanentView } from "./permanentView";
import { handCardMatchesFilter } from "./alternativeCost";
import { liveSupertypesOf } from "./snow";
import {
    isTapOtherSelectionComplete,
    pickTapOtherPayment,
} from "./tapOtherCost";
import {
    tapOtherContribution,
    type ParkKind,
    type OwedPayment,
} from "./owedPayment";
import {
    nextUnmetRequirement,
    sacrificeCandidates,
    isSacrificeSelectionComplete,
    type SacrificeSelection,
} from "./sacrificeChoice";
import type { CardInstanceState, GameState, PlayerState } from "./state";

// ────────────────────────────────────────────────────────────────────────────
// Shared conservative primitives (used here AND by `activationCostPicks.ts`)
// ────────────────────────────────────────────────────────────────────────────

/** Mana value of a card instance's definition (CR 202.3), 0 when unknown. */
export function instanceManaValue(card: CardInstanceState): number {
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    return manaValue(def?.manaCost);
}

/** Ascending mana value, ties broken on instance id — the conservative default
 *  ordering for every "which of my own cards pays this?" pick, and stable
 *  across runs (determinism is a hard requirement for the search). */
export function cheapestFirst(
    cards: readonly CardInstanceState[]
): CardInstanceState[] {
    return [...cards].sort(
        (a, b) =>
            instanceManaValue(a) - instanceManaValue(b) ||
            a.id.localeCompare(b.id)
    );
}

/** Legal victims for the selection's next unmet requirement, CHEAPEST FIRST and
 *  excluding everything already picked (CR 118.5 — each requirement is paid from
 *  distinct permanents). */
export function nextSacrificeCandidates(
    state: GameState,
    sel: SacrificeSelection
): CardInstanceState[] {
    const req = nextUnmetRequirement(sel);
    if (!req) return [];
    const taken = new Set(sel.picked);
    return cheapestFirst(
        sacrificeCandidates(state, sel.playerId, req.filter).filter(
            (c) => !taken.has(c.id)
        )
    );
}

/** Completes `sel` IN PLACE with the cheapest legal victims and returns the ids
 *  the payer must SUBMIT (victims `autoResolveFungible` already recorded at
 *  announcement are not re-submitted — the server would reject them).
 *  `null` when a requirement cannot be met: the payment is then illegal.
 *
 *  `spare` names instances the PAYER declines to offer even though the rules
 *  allow them — never a legality filter (the server's own candidate set is
 *  unchanged), only a preference the chooser is entitled to have under
 *  CR 601.2h. A requirement that can only be met from `spare` returns `null`,
 *  exactly as an unmet one does. */
export function completeSacrificeSelection(
    state: GameState,
    sel: SacrificeSelection,
    first?: CardInstanceState,
    spare?: ReadonlySet<string>
): string[] | null {
    const submitted: string[] = [];
    let head = first;
    while (!isSacrificeSelectionComplete(sel)) {
        const pick =
            head ??
            nextSacrificeCandidates(state, sel).find((c) => !spare?.has(c.id));
        head = undefined;
        if (!pick) return null;
        sel.picked.push(pick.id);
        submitted.push(pick.id);
    }
    return submitted;
}

// ────────────────────────────────────────────────────────────────────────────
// Park-specific pickers, expressed over the shape the CLIENT can also build
// ────────────────────────────────────────────────────────────────────────────
//
// These three types + choosers moved here from `src/lib/ai/brain.ts` (issue
// #1209): they were the only park answers the bot had, each written once for
// the reactive path, and the fallback below needs the SAME answer rather than a
// second opinion. `brain.ts` re-exports them, so every existing importer is
// unchanged.

/** The parked graveyard/hand exile CAST cost (CR 601.2g / 702.66 / 702.34a),
 *  reduced to what the deterministic picker needs. */
export type CastExileChoiceView = {
    /** Ids the payer may pay with, in zone order (its own graveyard or hand,
     *  the cast card itself already excluded). */
    candidateIds: string[];
    /** How many ids MUST be submitted — the exact count for a fixed cost, the
     *  forced `offsetGeneric.min` for delve (0 when delving is optional). */
    required: number;
    /** Upper bound on the submission (`offsetGeneric.max` for delve, otherwise
     *  the same as `required`). */
    maximum: number;
};

/** The parked generic-mana spend choice (CR 601.2g, #1444/#1446), reduced to
 *  what the deterministic flexibility heuristic needs. */
export type ManaSpendChoiceView = {
    /** How much generic mana is still owed (CR 601.2g). */
    generic: number;
    /** The pool colors the generic may legally be drawn from, in canonical
     *  W,U,B,R,G,C order (mirrors `GenericSpendAmbiguity.candidateColors`). */
    candidateColors: string[];
    /** The payer's current pool amount for each candidate color — caps how much
     *  of that color the spend order may draw. */
    poolCounts: Record<string, number>;
    /** Heuristic usefulness score per candidate color (issue #1446): the total
     *  colored pips of that color required among the payer's OTHER remaining
     *  hand spells this turn. The color scoring HIGHEST is the one worth
     *  protecting — {@link chooseManaSpendOrder} drains it LAST, spending the
     *  most disposable (least useful) color first to preserve flexibility. */
    colorUsefulness: Record<string, number>;
};

/** The parked Convoke creature picker (CR 702.51), reduced to what the
 *  deterministic picker needs. */
export type ConvokeChoiceView = {
    /** The payer's untapped creatures it may tap, each with its live colours. */
    candidates: { id: string; colors: string[] }[];
    /** Guild-hybrid pips convoke MUST satisfy (colour-matched). */
    hybridPips: [string, string][];
    /** Single-colour pips convoke must satisfy (usually empty). */
    coloredPips: Record<string, number>;
    /** Forced minimum creatures to tap. */
    min: number;
    /** Maximum creatures to tap. */
    max: number;
};

/** CR 601.2g (issue #1446) — the deterministic flexibility-preserving answer to
 *  a parked generic-spend choice: build a color order of length `generic`
 *  (one entry per owed generic pip), spending the MOST-DISPOSABLE candidate
 *  color first (ascending `colorUsefulness`, `candidateColors`' own canonical
 *  W,U,B,R,G,C order breaking ties via the stable sort) so the pool retains as
 *  much of the color(s) the payer's other remaining hand spells still need. Each
 *  color is drawn only up to its `poolCounts` amount, spilling into the next
 *  least-useful color once exhausted — always a legal multiset (⊆ pool) of
 *  exactly `generic` entries, so `resolveManaSpendChoice` never rejects it.
 *  Deterministic and side-effect free. */
export function chooseManaSpendOrder(choice: ManaSpendChoiceView): string[] {
    const { generic, candidateColors, poolCounts, colorUsefulness } = choice;
    const order = [...candidateColors].sort(
        (a, b) => (colorUsefulness[a] ?? 0) - (colorUsefulness[b] ?? 0)
    );
    const remaining = { ...poolCounts };
    const spendOrder: string[] = [];
    for (const color of order) {
        while (spendOrder.length < generic && (remaining[color] ?? 0) > 0) {
            spendOrder.push(color);
            remaining[color] = (remaining[color] ?? 0) - 1;
        }
        if (spendOrder.length >= generic) break;
    }
    return spendOrder;
}

/** CR 601.2g / 702.66 — the deterministic answer to a parked graveyard-exile
 *  cast cost: exile exactly the number REQUIRED (`required`), taking them from
 *  the front of the payer's own graveyard. For delve (`required` = the forced
 *  `offsetGeneric.min`) that is precisely the amount the move enumerator already
 *  discounted from the tap plan, so the taps and the exiles cover the cost
 *  between them; delving further would burn graveyard resources the mana did not
 *  need. For a fixed flashback / escape cost `required` equals the exact count
 *  the picker demands. Clamped to what is actually available so an
 *  under-supplied view can never emit an illegal submission (issue #1336). */
export function chooseCastExileCost(choice: CastExileChoiceView): string[] {
    const n = Math.min(
        choice.required,
        choice.maximum,
        choice.candidateIds.length
    );
    return choice.candidateIds.slice(0, Math.max(0, n));
}

/** CR 702.51 (issue #1338) — the deterministic answer to a parked Convoke
 *  creature picker: a MINIMAL legal covering set. Colour-match the
 *  single-colour and guild-hybrid pips convoke must pay (each to the
 *  least-flexible untapped creature that can pay it — the same greedy the server
 *  validates with, `coverColoredAndHybridPips`), then top up to the forced `min`
 *  with any remaining creatures, capped at `max`. Pure and deterministic. */
export function chooseConvokeCreatures(choice: ConvokeChoiceView): string[] {
    const pool = choice.candidates.map((c) => ({
        id: c.id,
        colors: new Set(c.colors),
    }));
    const used = new Set<string>();
    const pickLeastFlexible = (
        pred: (colors: Set<string>) => boolean
    ): string | undefined => {
        let bestId: string | undefined;
        let bestSize = Infinity;
        for (const cand of pool) {
            if (used.has(cand.id)) continue;
            if (pred(cand.colors) && cand.colors.size < bestSize) {
                bestId = cand.id;
                bestSize = cand.colors.size;
            }
        }
        if (bestId !== undefined) used.add(bestId);
        return bestId;
    };
    const picked: string[] = [];
    for (const [color, n] of Object.entries(choice.coloredPips)) {
        for (let i = 0; i < n; i++) {
            const id = pickLeastFlexible((colors) => colors.has(color));
            if (id !== undefined) picked.push(id);
        }
    }
    for (const [c1, c2] of choice.hybridPips) {
        const id = pickLeastFlexible(
            (colors) => colors.has(c1) || colors.has(c2)
        );
        if (id !== undefined) picked.push(id);
    }
    // Top up to the forced minimum with any remaining creatures.
    for (const cand of pool) {
        if (picked.length >= choice.min) break;
        if (!used.has(cand.id)) {
            used.add(cand.id);
            picked.push(cand.id);
        }
    }
    return picked.slice(0, Math.max(0, choice.max));
}

// ────────────────────────────────────────────────────────────────────────────
// The submission
// ────────────────────────────────────────────────────────────────────────────

/** A park answer, named as the HUMAN mutation that pays it plus its arguments
 *  (minus `gameId`/`playerId`, which the caller owns). One pick per call
 *  (ADR 0091 decision 5) — the `*Each` shapes below fire one mutation per id, in
 *  order, because that is what the server's picker accepts. */
export type OwedPaymentSubmission =
    /** CR 701.21 / 601.2f — one call per victim; the server routes it to
     *  whichever in-flight cast/activation awaits a sacrifice choice. */
    | { mutation: "selectSacrifice"; cardInstanceIdEach: string[] }
    /** CR 118.8 — the cast-side exile additional cost (Soul Exchange). */
    | { mutation: "selectAdditionalCost"; cardInstanceId: string }
    /** CR 702.51 — convoke. */
    | { mutation: "selectConvokeCreatures"; creatureInstanceIds: string[] }
    /** CR 702.34a / 702.66 — the cast-side graveyard/hand exile cost. */
    | { mutation: "selectCastExileCost"; cardInstanceIds: string[] }
    /** CR 118.9 — the alternative-cost / kicker hand leg. */
    | { mutation: "selectCastAlternativeHandCost"; cardInstanceIds: string[] }
    /** CR 118.8 / 702.122a — one call per tapped permanent (crew reaches 2-3). */
    | { mutation: "selectActivationCost"; cardInstanceIdEach: string[] }
    /** CR 118.5 — the activation-side graveyard exile cost. */
    | {
          mutation: "selectActivationExileCost";
          graveyardOwnerId: string;
          cardInstanceIds: string[];
      }
    /** CR 118.3 — the activation-side filtered discard cost. */
    | { mutation: "selectActivationDiscardCost"; cardInstanceIds: string[] }
    /** CR 601.2g — the ambiguous generic-mana spend. */
    | { mutation: "resolveManaSpendChoice"; spendOrder: string[] };

function assertNever(x: never): never {
    throw new Error(`Unhandled park kind: ${JSON.stringify(x)}`);
}

/** Untapped creatures the payer may convoke with, carrying their LIVE colours
 *  (the same `STATIC_EFFECT_CTX.getColors` the server validates coverage with,
 *  CR 105.2 / 613). */
function convokeViewFor(
    player: PlayerState,
    cc: NonNullable<GameState["pendingCast"]>["convokeCreatureChoice"]
): ConvokeChoiceView | null {
    if (!cc) return null;
    return {
        candidates: player.battlefield
            .filter((c) => c.types.includes("Creature") && !c.isTapped)
            .map((c) => ({
                id: c.id,
                colors: STATIC_EFFECT_CTX.getColors(c) as string[],
            })),
        hybridPips: cc.hybridPips as [string, string][],
        coloredPips: (cc.coloredPips ?? {}) as Record<string, number>,
        min: cc.min,
        max: cc.max,
    };
}

/** The cast-side exile picker's candidate ids + bounds, read off the payer's own
 *  graveyard/hand (CR 702.34a / 702.66 / 702.138a).
 *
 *  Exported for `gre/castCostPicks.ts` (issue #2980): the Bot's move enumerator
 *  plans an escape / non-mana-flashback exile cost by building the SAME view and
 *  feeding it to the SAME {@link chooseCastExileCost}, so the ids the search
 *  charges are byte-identical to the ones this module's live reactive fallback
 *  would submit for the same park. */
export function castExileViewFor(
    player: PlayerState,
    ec: NonNullable<GameState["pendingCast"]>["exileFromGraveyardChoice"]
): CastExileChoiceView | null {
    if (!ec) return null;
    const zone = ec.zone ?? "graveyard";
    const source = zone === "hand" ? player.hand : player.graveyard;
    // CHEAPEST FIRST, not graveyard order (issue #2980) — the same conservative
    // ordering every other "which of my own cards pays this?" pick already uses
    // (`cheapestFirst`, above). Zone order is arbitrary: it spends whatever
    // happens to be at the front, which under Underworld Breach (CR 702.138 —
    // "each NONLAND card in your graveyard has escape") means the escape cost
    // routinely exiles the very card the next escape wanted, while a LAND — a
    // card the grant can never make castable, so pure fodder — sits untouched
    // behind it. Mana value is the available proxy for that: lands and cheap
    // spells go first, the expensive cards the graveyard is being kept for go
    // last. Ties break on instance id, so the order is still stable across runs
    // (determinism is a hard requirement for the search).
    const candidateIds = cheapestFirst(
        source.filter((c) =>
            isExileCostEligible(c, ec.excludeInstanceId, ec.color)
        )
    ).map((c) => c.id);
    // Delve's variable-offset mode is bounded by `offsetGeneric`; the escape
    // card-type mode has no fixed count, so exile everything eligible (the only
    // submission guaranteed to clear any card-type threshold); every other mode
    // demands an exact `count`.
    const required = ec.offsetGeneric
        ? ec.offsetGeneric.min
        : ec.minCardTypes !== undefined
          ? candidateIds.length
          : ec.count;
    return {
        candidateIds,
        required,
        maximum: ec.offsetGeneric ? ec.offsetGeneric.max : required,
    };
}

/** CR 601.2g — the SERVER-side conservative spend order: no hand-flexibility
 *  score is available here (that heuristic is the client Brain's, built from the
 *  bot's own projected hand), so every candidate colour scores 0 and
 *  {@link chooseManaSpendOrder} falls back to the pool's canonical W,U,B,R,G,C
 *  order. Always a legal multiset ⊆ pool, which is what the fallback needs. */
function manaSpendViewFor(
    player: PlayerState,
    choice: { generic: number; candidateColors: readonly string[] }
): ManaSpendChoiceView {
    const pool = player.manaPool as unknown as Record<string, number>;
    const poolCounts: Record<string, number> = {};
    for (const color of choice.candidateColors) {
        poolCounts[color] = pool[color] ?? 0;
    }
    return {
        generic: choice.generic,
        candidateColors: [...choice.candidateColors],
        poolCounts,
        colorUsefulness: {},
    };
}

/** CR 118.9 — a greedy hand pick satisfying every requirement of the
 *  alternative-cost hand leg, mirroring the server's own greedy validation
 *  (`validateAlternativeHandCostPick`): walk the requirements in order and take
 *  the cheapest still-unused matching hand card for each. The spell itself is
 *  never eligible (CR 601.2b — it can't pay for its own cost). */
function pickAlternativeHandCost(
    player: PlayerState,
    choice: NonNullable<
        NonNullable<GameState["pendingCast"]>["alternativeCostHandChoice"]
    >
): string[] | null {
    const used = new Set<string>([choice.excludeInstanceId]);
    const picked: string[] = [];
    for (const req of choice.requirements) {
        let need = req.count;
        for (const card of cheapestFirst(player.hand)) {
            if (need <= 0) break;
            if (used.has(card.id)) continue;
            if (!handCardMatchesFilter(card, req.filter)) continue;
            used.add(card.id);
            picked.push(card.id);
            need -= 1;
        }
        if (need > 0) return null;
    }
    return picked;
}

/** The conservative submission that pays `owed`, or `null` when no legal
 *  payment exists (the announcement is then doomed and the payer must cancel).
 *
 *  Exhaustive over {@link ParkKind} — a new park cannot compile without an
 *  answer here. Pure: `state` is never mutated (the sacrifice legs work on a
 *  cloned selection). */
export function pickForOwedPayment(
    state: GameState,
    playerId: string,
    owed: OwedPayment
): OwedPaymentSubmission | null {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return null;
    const pc = state.pendingCast;
    const pa = state.pendingActivation;
    const kind: ParkKind = owed.kind;

    switch (kind) {
        // ── CAST ────────────────────────────────────────────────────────────
        case "cast:sacrificeSelection":
        case "activation:sacrificeSelection": {
            const sel =
                kind === "cast:sacrificeSelection"
                    ? pc?.sacrificeSelection
                    : pa?.sacrificeSelection;
            if (!sel) return null;
            // Work on a CLONE: the real selection is the server's, and this
            // function must not mutate the caller's state.
            const trial: SacrificeSelection = {
                ...sel,
                picked: [...sel.picked],
            };
            const submitted = completeSacrificeSelection(state, trial);
            if (submitted === null || submitted.length === 0) return null;
            return {
                mutation: "selectSacrifice",
                cardInstanceIdEach: submitted,
            };
        }
        case "cast:additionalCost": {
            const ac = pc?.additionalCost;
            if (!ac) return null;
            const candidates = cheapestFirst(
                player.battlefield.filter((c) =>
                    matchesPermanentFilter(
                        effectivePermanentView(state, c),
                        ac.filter,
                        { selfControllerId: playerId }
                    )
                )
            );
            const pick = candidates[0];
            if (!pick) return null;
            return {
                mutation: "selectAdditionalCost",
                cardInstanceId: pick.id,
            };
        }
        case "cast:convokeCreatureChoice": {
            const view = convokeViewFor(player, pc?.convokeCreatureChoice);
            if (!view) return null;
            return {
                mutation: "selectConvokeCreatures",
                creatureInstanceIds: chooseConvokeCreatures(view),
            };
        }
        case "cast:exileFromGraveyardChoice": {
            const view = castExileViewFor(player, pc?.exileFromGraveyardChoice);
            if (!view) return null;
            return {
                mutation: "selectCastExileCost",
                cardInstanceIds: chooseCastExileCost(view),
            };
        }
        case "cast:alternativeCostHandChoice": {
            // Reachability: LIVE since issue #2379. The park is shared by two
            // producers, and only one of them reaches it today:
            //   • CR 118.9 alternative costs with a hand leg (Force of Will) —
            //     still unreachable: `moves.ts` emits no alt-cost / kicker-paid
            //     cast variant, so those cards are dead for the bot rather than
            //     stalling. Live when #2081 / #2135 land the enumerator.
            //   • CR 601.2b caster-chosen ADDITIONAL cost with a discard leg
            //     (Bitter Triumph) — REACHED: `moves.ts` enumerates one cast
            //     per payable leg via `payableAdditionalCostLegs`, and the
            //     discard leg parks exactly here (`additionalCostHandLeg` feeds
            //     `buildCastHandCostChoice`'s `extraLegs`). Covered by
            //     `convex/__tests__/additionalCostLegChoice.test.ts`.
            const choice = pc?.alternativeCostHandChoice;
            if (!choice) return null;
            const ids = pickAlternativeHandCost(player, choice);
            if (!ids) return null;
            return {
                mutation: "selectCastAlternativeHandCost",
                cardInstanceIds: ids,
            };
        }
        // ── ACTIVATION ──────────────────────────────────────────────────────
        case "activation:exileFromGraveyardChoice": {
            const ec = pa?.exileFromGraveyardChoice;
            if (!ec) return null;
            // CR 118.5 — the WHOLE cost comes from ONE graveyard. Prefer an
            // opponent's when any is eligible (their graveyard is a resource the
            // payer wants gone anyway); `owner: "you"` admits only its own.
            const sources =
                ec.owner === "you"
                    ? [player]
                    : [
                          ...state.players.filter((p) => p.id !== playerId),
                          ...state.players.filter((p) => p.id === playerId),
                      ];
            for (const p of sources) {
                const matching = p.graveyard.filter(
                    (c) =>
                        ec.cardType === undefined ||
                        c.types.includes(ec.cardType)
                );
                if (matching.length < ec.count) continue;
                return {
                    mutation: "selectActivationExileCost",
                    graveyardOwnerId: p.id,
                    cardInstanceIds: cheapestFirst(matching)
                        .slice(0, ec.count)
                        .map((c) => c.id),
                };
            }
            return null;
        }
        case "activation:tapOtherChoice": {
            const toc = pa?.tapOtherChoice;
            if (!toc) return null;
            // Only the picks still MISSING: `pickedIds` are already recorded
            // server-side and re-submitting one is rejected. Highest crew
            // contribution first so the fewest bodies are tapped (CR 702.122a);
            // ties on id for determinism.
            const already = new Set(toc.pickedIds);
            const candidates = player.battlefield
                .filter(
                    (c) =>
                        c.id !== pa?.cardInstanceId &&
                        !c.isTapped &&
                        !already.has(c.id) &&
                        // The layered view (`gre/permanentView.ts`), matching
                        // the server's own candidate scan (`tapOtherCandidates`,
                        // `game.ts`): a `colors` filter (Hand of Justice's
                        // "white creatures") must read the colour the rest of
                        // the engine sees, not the raw instance — which carries
                        // no `colors` field at all, so the filter would never
                        // match and the pick would come back empty.
                        matchesPermanentFilter(
                            effectivePermanentView(state, c),
                            toc.filter,
                            {
                                selfControllerId: playerId,
                                supertypesOf: liveSupertypesOf,
                            }
                        )
                )
                .map((c) => tapOtherContribution(state, c))
                .sort((a, b) => a.id.localeCompare(b.id));
            // Only the picks still MISSING, and only as many as the cost still
            // needs: `pickedIds` are already recorded server-side (re-submitting
            // one is rejected), and the server COMMITS the activation the moment
            // the cost is covered — an extra call after that would throw. So the
            // outstanding remainder is what the payment is, computed with the
            // same greedy the enumerator uses (CR 118.8 / 702.122a).
            const outstanding = {
                filter: toc.filter,
                count:
                    toc.count === undefined
                        ? undefined
                        : Math.max(0, toc.count - toc.pickedIds.length),
                totalPower:
                    toc.totalPower === undefined
                        ? undefined
                        : Math.max(0, toc.totalPower - (toc.pickedPower ?? 0)),
            };
            const picked = pickTapOtherPayment(outstanding, candidates);
            if (!isTapOtherSelectionComplete(outstanding, picked)) return null;
            return {
                mutation: "selectActivationCost",
                cardInstanceIdEach: picked.map((c) => c.id),
            };
        }
        case "activation:discardFilterChoice": {
            const dc = pa?.discardFilterChoice;
            if (!dc) return null;
            const candidates = cheapestFirst(
                player.hand.filter((c) => handCardMatchesFilter(c, dc.filter))
            );
            if (candidates.length < dc.count) return null;
            return {
                mutation: "selectActivationDiscardCost",
                cardInstanceIds: candidates.slice(0, dc.count).map((c) => c.id),
            };
        }
        // ── BOTH ────────────────────────────────────────────────────────────
        case "cast:manaSpendChoice":
        case "activation:manaSpendChoice": {
            const choice =
                kind === "cast:manaSpendChoice"
                    ? pc?.manaSpendChoice
                    : pa?.manaSpendChoice;
            if (!choice) return null;
            return {
                mutation: "resolveManaSpendChoice",
                spendOrder: chooseManaSpendOrder(
                    manaSpendViewFor(player, choice)
                ),
            };
        }
        default:
            return assertNever(kind);
    }
}
