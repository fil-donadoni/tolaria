// Builds the slim `BotView` the cheap main-thread gate reasons about, from the
// bot's projected wire state (ADR 0001, issues #109/#145). Pure and React-free
// so it can be unit/integration tested without a browser: the driver hook and
// the tests share this one builder.
//
// `enumerateMoves` / the ISMCTS search only run for windows the gate flags as
// worth a Worker round-trip; the mulligan heuristic (issue #145) is resolved
// here on the main thread from `mulliganHand` / `mulligansTaken` and never
// reaches the Worker.

import type {
    PublicGameState,
    SlimCardInstance,
} from "@convex/gameProjections";
import type { Move, PendingChoice } from "@convex/gre";
import {
    getPendingChoiceMin,
    getPendingChoiceMax,
    normalizeManaCost,
    isManaCostCovered,
    mayPayHandLegCount,
    assignMayPayHandCards,
    normalizeMayPayCost,
    isSearchableChoiceNode,
} from "@convex/gre";
import { cardValueById } from "@convex/gre";
import { manaValue, parseHybridCostKey } from "@convex/gre/constants";
import { matchesPermanentFilter } from "@convex/cards/filters";
import { hasControlledSinceTurnStart } from "@convex/gre/controlContinuity";
import { getColorsFromCost, getCardColorIdentity } from "@convex/cards/colors";
import { tryGetDefinition } from "@convex/cards";
import { isExileCostEligible } from "@convex/cards/exileCostEligibility";
import type { Color } from "@convex/cards/types";
import { STATIC_EFFECT_CTX } from "@convex/gre/layers";
import type {
    BotAction,
    BotView,
    CastExileChoiceView,
    ChoiceCandidate,
    ConvokeChoiceView,
    ManaSituation,
    ManaSpendChoiceView,
    OwedChoice,
} from "./brain";

/** Whether the bot still owes a combat-damage confirmation this step. True only
 *  when a damage step is open (`damageConfirmed === false`), the bot is one of
 *  the step's assigners (CR 702.21j-k — the source controller, banding can shift
 *  it), and it has not yet confirmed its portion. Mirrors the `confirmDamage`
 *  server gate so an accepted confirmation is never rejected, and clears once the
 *  bot has confirmed so the driver doesn't loop while another assigner is still
 *  outstanding. */
function botOwesDamageConfirm(
    combat: PublicGameState["combat"],
    botId: string
): boolean {
    if (!combat || combat.damageConfirmed !== false) return false;
    const assigners = new Set(Object.values(combat.damageAssignerIds ?? {}));
    if (!assigners.has(botId)) return false;
    const confirmedBy = new Set(combat.damageAssignmentConfirmedBy ?? []);
    return !confirmedBy.has(botId);
}

/** Land detection on a projected hand card. The slim instance keeps the
 *  `types` array from `CardInstanceState` (only `card` is stripped), so a land
 *  is any card whose printed types include "Land" (CR 305.1). */
function handCardIsLand(types: string[] | undefined): boolean {
    return (types ?? []).includes("Land");
}

/** Map a slim card the bot can see into a {@link ChoiceCandidate} for the
 *  default-selection policy. The bot has full identity of its OWN owed-choice
 *  cards, so the projected latent `value` is derived from the card id via the
 *  shared `cardValueById` (ADR 0018, issue #197). This value lives only on the
 *  bot-only owed-choice path — never the 2-player public projection. */
function toCandidate(card: SlimCardInstance): ChoiceCandidate {
    // `card.id` is the INSTANCE id (what the submission selects); `card.card.id`
    // is the card-definition id the shared `cardValueById` derives worth from.
    const def = tryGetDefinition(card.card.id);
    // CR 305.1 — a land has "Land" among its (projected) printed types; the
    // discard heuristic (issue #242) treats lands as the constraining resource.
    const isLand = handCardIsLand(card.types);
    return {
        id: card.id,
        value: cardValueById(card.card.id),
        isLand,
        // CR 202.3 — mana value of the cost (X folded). Lands cost nothing.
        manaValue: manaValue(def?.manaCost),
        // CR 202.2 — colors the cost demands; empty for lands / colorless.
        colors: getColorsFromCost(def?.manaCost),
        // CR 118 — PRINTED power, the minimal-legal proxy the threshold-mode
        // may-pay sacrifice greedy uses ("total power ≥ N", Phyrexian
        // Dreadnought). Layer-modified effective power isn't reachable from the
        // projected client state; printed power is exact for the vanilla bodies
        // this path targets (ADR 0016 minimal-legal default).
        power: def?.power,
    };
}

/** Distinct colors the controller's lands in play can currently produce
 *  (issue #242). Reads the bot's visible battlefield: each land's
 *  color-identity (`getCardColorIdentity` — basic subtypes + declared mana abilities)
 *  contributes to the producible set. A spell needing a color outside this set
 *  is "uncastable" for the discard ranking. */
function producibleColors(battlefield: SlimCardInstance[]): Color[] {
    const set = new Set<Color>();
    for (const perm of battlefield) {
        if (!handCardIsLand(perm.types)) continue;
        const def = tryGetDefinition(perm.card.id);
        if (!def) continue;
        for (const c of getCardColorIdentity(def)) set.add(c);
    }
    return [...set];
}

/** The controller's mana picture for a `discard-hand` choice (issue #242),
 *  read from the bot's visible battlefield and hand. */
function buildManaSituation(
    state: PublicGameState,
    botId: string
): ManaSituation {
    const bot = state.players.find((p) => p.id === botId);
    const battlefield = bot?.battlefield ?? [];
    const hand = (bot?.hand ?? []).filter(
        (c): c is NonNullable<typeof c> => c !== null
    );
    return {
        landsInPlay: battlefield.filter((c) => handCardIsLand(c.types)).length,
        landsInHand: hand.filter((c) => handCardIsLand(c.types)).length,
        producibleColors: producibleColors(battlefield),
    };
}

/** CR 601.2g (issue #1444/#1446) — read the parked generic-mana spend choice
 *  awaiting the bot as PAYER of its own cast/activation. `pendingCast` /
 *  `pendingActivation` ride the wire un-slimmed (`PublicGameState` only omits
 *  `players`/`stack`/`phasedOut`/`pendingTriggerBatch`), so this is a direct
 *  read, mirroring `payment-banner.tsx`'s `pendingCast.sacrificeSelection` and
 *  the attack-tax park above. Undefined unless the bot itself owes the choice. */
function buildManaSpendChoiceView(
    state: PublicGameState,
    botId: string
): ManaSpendChoiceView | undefined {
    const pc = state.pendingCast;
    const pa = state.pendingActivation;
    const parked =
        pc && pc.playerId === botId && pc.manaSpendChoice
            ? { choice: pc.manaSpendChoice, sourceId: pc.cardInstanceId }
            : pa && pa.playerId === botId && pa.manaSpendChoice
              ? { choice: pa.manaSpendChoice, sourceId: pa.cardInstanceId }
              : undefined;
    if (!parked) return undefined;

    const bot = state.players.find((p) => p.id === botId);
    const pool = (bot?.manaPool ?? {}) as Record<string, number>;
    const poolCounts: Record<string, number> = {};
    for (const color of parked.choice.candidateColors) {
        poolCounts[color] = pool[color] ?? 0;
    }

    // Issue #1446 flexibility heuristic input: how much the bot's OTHER
    // remaining hand spells (excluding the card currently being cast, when
    // it's still sitting in hand) need each candidate color — the color that
    // scores HIGHEST here is the one worth protecting.
    const hand = (bot?.hand ?? []).filter(
        (c): c is NonNullable<typeof c> => c !== null
    );
    const colorUsefulness: Record<string, number> = {};
    for (const card of hand) {
        if (card.id === parked.sourceId) continue;
        if (handCardIsLand(card.types)) continue;
        const def = tryGetDefinition(card.card.id);
        if (!def?.manaCost) continue;
        const norm = normalizeManaCost(def.manaCost);
        for (const color of parked.choice.candidateColors) {
            const pips = norm[color] ?? 0;
            if (pips > 0) {
                colorUsefulness[color] = (colorUsefulness[color] ?? 0) + pips;
            }
        }
        // Issue #1741 — a guild-hybrid pip (CR 202.1a) is folded into the
        // normalized cost under a COMPOSITE key (`"R/W"`, issue #1738), not a
        // flat colour key, so the flat-key scan above always reads zero pips
        // for a hybrid card: a hand-only {R/W} one-drop contributed nothing to
        // either colour's usefulness and the bot couldn't tell a Mountain was
        // worth protecting for it. Count each hybrid pip toward EVERY
        // candidate colour that can pay it — either one makes the card
        // castable, so both are "useful" to protect.
        for (const [key, count] of Object.entries(norm)) {
            if (count <= 0) continue;
            const pair = parseHybridCostKey(key);
            if (!pair) continue;
            for (const color of pair) {
                if (!parked.choice.candidateColors.includes(color)) continue;
                colorUsefulness[color] = (colorUsefulness[color] ?? 0) + count;
            }
        }
    }

    return {
        generic: parked.choice.generic,
        candidateColors: parked.choice.candidateColors,
        poolCounts,
        colorUsefulness,
    };
}

/** CR 601.2g / 702.66 (issue #1336) — read the parked graveyard/hand EXILE cast
 *  cost awaiting the bot as PAYER of its own cast: delve's variable offset, and
 *  the fixed flashback / escape exile costs that ride the same picker.
 *  `pendingCast` rides the wire un-slimmed, and the bot's own graveyard/hand are
 *  fully visible on its projection, so this is a direct read — mirroring
 *  `buildManaSpendChoiceView` above. Undefined unless the bot itself owes an
 *  UNPAID pick. */
function buildCastExileChoiceView(
    state: PublicGameState,
    botId: string
): CastExileChoiceView | undefined {
    const pc = state.pendingCast;
    const ec = pc?.exileFromGraveyardChoice;
    if (!pc || !ec || pc.playerId !== botId || ec.pickedCardIds) {
        return undefined;
    }
    const bot = state.players.find((p) => p.id === botId);
    const zone = ec.zone ?? "graveyard";
    const source = zone === "hand" ? (bot?.hand ?? []) : (bot?.graveyard ?? []);
    // Issue #1659 — `isExileCostEligible` mirrors the check the server
    // (`recordCastExileCostPick`, via `graveyardCardMatchesColor`, which
    // delegates its colour leg straight to this same function) and the human
    // picker (`CastExileCostDialog`'s `eligible` memo) consult. Without the
    // `ec.color` check this dropped, the bot could submit a colour-ineligible
    // instance id (Flash of Insight's "exile X blue cards") and the mutation
    // would reject it — a stall that shows up client-side as a retry loop
    // (`useVsAiDriver`'s `.catch(() => lastSignature.current = null)`).
    const candidateIds = source
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .filter((c) => isExileCostEligible(c, ec.excludeInstanceId, ec.color))
        .map((c) => c.id);
    // CR 702.66 — delve's variable-offset mode is bounded by `offsetGeneric`
    // (`min` forced, `max` the generic remaining); every other mode demands an
    // exact `count`. The Nethergoyf card-type mode has no fixed count — it is
    // not in the bot's pool yet, so treat it as "exile everything eligible",
    // the only submission guaranteed to clear any card-type threshold.
    const required = ec.offsetGeneric
        ? ec.offsetGeneric.min
        : ec.minCardTypes !== undefined
          ? candidateIds.length
          : ec.count;
    const maximum = ec.offsetGeneric ? ec.offsetGeneric.max : required;
    return { candidateIds, required, maximum };
}

/** CR 702.51 (issue #1338) — read the parked Convoke creature picker awaiting the
 *  bot as PAYER of its own cast (Hogaak). `pendingCast` rides the wire un-slimmed
 *  and the bot's own battlefield is fully visible, so this is a direct read
 *  mirroring `buildCastExileChoiceView`. Each candidate carries its live colours
 *  (the SAME `STATIC_EFFECT_CTX.getColors` the server validates coverage with) so
 *  `chooseConvokeCreatures` can colour-match the hybrid pips. Undefined unless the
 *  bot itself owes an UNPAID pick. */
function buildConvokeChoiceView(
    state: PublicGameState,
    botId: string
): ConvokeChoiceView | undefined {
    const pc = state.pendingCast;
    const cc = pc?.convokeCreatureChoice;
    if (!pc || !cc || pc.playerId !== botId || cc.pickedCreatureIds) {
        return undefined;
    }
    const bot = state.players.find((p) => p.id === botId);
    const candidates = (bot?.battlefield ?? [])
        .filter(
            (c) => c.types?.includes("Creature") === true && c.isTapped !== true
        )
        .map((c) => ({
            id: c.id,
            colors: STATIC_EFFECT_CTX.getColors(
                c as Parameters<typeof STATIC_EFFECT_CTX.getColors>[0]
            ) as string[],
        }));
    return {
        candidates,
        hybridPips: cc.hybridPips as [string, string][],
        coloredPips: (cc.coloredPips ?? {}) as Record<string, number>,
        min: cc.min,
        max: cc.max,
    };
}

/** Read the cards the bot may legally pick for `head` from its projected view.
 *  The wire projection already exposes the relevant zone to the chooser
 *  (`librarySearch` for search, `libraryPeek` for reorder, `revealedHand` for
 *  reveal, the bot's own visible hand/battlefield otherwise — see
 *  `projectPublicState`). Returns [] for choices that pick from no zone
 *  (`may-pay`). Applies the battlefield `filter` and the `candidateIds`
 *  allow-list with the SAME `matchesPermanentFilter` the server uses in
 *  `applyPendingChoiceSubmit`, so the candidate set never over-includes an id
 *  the server would reject (which would freeze the game on submit). */
function readChoiceZone(
    state: PublicGameState,
    head: PendingChoice,
    botId: string
): SlimCardInstance[] {
    const ownerId = head.zoneOwnerId ?? botId;
    const owner = state.players.find((p) => p.id === ownerId);
    if (!owner) return [];

    let cards: SlimCardInstance[];
    switch (head.zone) {
        case "library":
            cards =
                head.kind === "search-library"
                    ? (owner.librarySearch ?? [])
                    : (owner.libraryPeek ?? []);
            break;
        case "hand":
            // reveal-hand exposes the owner's hand face-up; otherwise the bot
            // picks from its own (always-visible) hand.
            cards =
                owner.revealedHand ??
                owner.hand.filter(
                    (c): c is NonNullable<typeof c> => c !== null
                );
            break;
        case "battlefield":
            cards = head.allControllers
                ? state.players.flatMap((p) => p.battlefield)
                : owner.battlefield;
            // CR-style permanent filter (types / subtypes / excludeInstanceIds /
            // …) — the slim projected card is structurally a MatchablePermanent.
            // CR 202.2 — the wire projection doesn't carry derived colors, so
            // populate them (colorOverride else printed cost) for color filters,
            // mirroring the server's effectivePermanentView.
            if (head.filter) {
                const filter = head.filter;
                cards = cards.filter((c) =>
                    matchesPermanentFilter(
                        {
                            ...c,
                            colors: ((c as { colorOverride?: string[] })
                                .colorOverride ??
                                getColorsFromCost(
                                    tryGetDefinition(
                                        (c.card as { id: string }).id
                                    )?.manaCost
                                )) as Color[],
                            // CR 400.7 — the two DERIVED turn-scoped flags,
                            // computed off state rather than stored on the
                            // instance. Same fail-CLOSED stall risk as
                            // `controllerRelation` below: without them a
                            // "creature you controlled since the beginning of
                            // the turn" sacrifice choice enumerates ZERO
                            // candidates and the bot freezes on a choice it
                            // must answer.
                            enteredThisTurn: c.enteredOnTurn === state.turn,
                            controlledSinceTurnStart:
                                hasControlledSinceTurnStart(state, c),
                        },
                        filter,
                        // CR 701.16 (issue #1938 fixup 2) — resolves
                        // `controllerRelation` ("sacrifice two Swamps YOU
                        // control", Infernal Denizen / Minion of Leshrac)
                        // against the CHOOSER. Without this the filter fails
                        // CLOSED, the candidate pool goes empty even though
                        // `head.candidateIds` (intersected below) already
                        // lists legal picks, and the bot can't enumerate a
                        // move for the pick — a silent stall, not a crash.
                        { selfControllerId: head.playerId }
                    )
                );
            }
            break;
        case "graveyard":
            // Recall (CR 400.7) — return N cards from the bot's own graveyard
            // to hand. The graveyard is a public zone, fully projected; the
            // `candidateIds` allow-list (applied below) narrows it to the
            // eligible snapshot.
            cards = owner.graveyard;
            break;
        case "exile":
            // Dauthi Voidwalker (CR 601.3e, issue #1156) — choose an exiled
            // card an opponent owns with a void counter. Exile is a public
            // zone (CR 400.2), fully projected like graveyard; the
            // `candidateIds` allow-list (applied below, precomputed from the
            // `hasCounter` filter) narrows it to the eligible snapshot.
            cards = owner.exile;
            break;
        default:
            return [];
    }

    if (head.candidateIds) {
        const allow = new Set(head.candidateIds);
        cards = cards.filter((c) => allow.has(c.id));
    }
    // look-distribute HAND-eligibility (issue #1266, Narset): only the
    // `eligibleIds` subset may go to hand; the bot submits hand picks only (the
    // rest auto-bottom), so narrowing the candidate pool keeps it from proposing
    // an illegal pick (a creature/land the server would reject → freeze).
    if (head.kind === "look-distribute" && head.eligibleIds) {
        const eligible = new Set(head.eligibleIds);
        cards = cards.filter((c) => eligible.has(c.id));
    }
    return cards;
}

/** Whether the bot can pay a `may-pay` cost from its CURRENT mana pool — the
 *  intentionally minimal "trivially affordable" test (ADR 0016). A cost-less
 *  may-pay is always affordable. `submitMayPay` pays from the pool only (lands
 *  must already be tapped) and throws if it can't cover, so this conservative
 *  check guarantees an accepted submission is never rejected back into a freeze;
 *  it ignores mana substitutions, which only make the server MORE permissive. */
function mayPayIsAffordable(
    state: PublicGameState,
    head: PendingChoice,
    botId: string
): boolean {
    if (!head.cost) return true;
    const bot = state.players.find((p) => p.id === botId);
    if (!bot) return false;
    // CR 702.24 — normalize the cost union (mana / life / sacrifice) and gate
    // every present leg. A bare `ManaCost` widens to `{ mana }` (ADR 0042), so
    // the historical mana-only path is unchanged.
    const norm = normalizeMayPayCost(head.cost);
    if (
        norm.mana &&
        !isManaCostCovered(bot.manaPool, normalizeManaCost(norm.mana))
    ) {
        return false;
    }
    if (norm.life !== undefined && bot.life < norm.life) return false;
    if (norm.permanent) {
        const matching = bot.battlefield.filter((c) =>
            matchesPermanentFilter(c, norm.permanent!.filter, {
                // CR 701.16 (issue #1938 fixup 2) — resolves
                // `controllerRelation` ("sacrifice two Swamps YOU control")
                // against the bot itself, the mayPay's payer. Without this the
                // filter fails CLOSED and the bot always evaluates a
                // controllerRelation-gated sacrifice leg as unaffordable, even
                // with legal candidates on board.
                selfControllerId: botId,
            })
        );
        if (typeof norm.permanent.count === "object") {
            // CR 118 threshold mode — affordable iff the payer's matching
            // permanents sum to ≥ the required total power. Uses PRINTED power
            // (the same proxy the accept-side greedy uses); layer-modified
            // effective power isn't reachable client-side. The ability's own
            // source is excluded (see `mayPaySourceInstanceId`): a rational bot
            // never self-sacrifices the very permanent the payment keeps, so it
            // must reach the threshold from the OTHER creatures alone — else it
            // declines and lets the "sacrifice it unless …" clause take the
            // source (CR 118). This keeps affordability consistent with the
            // accept-side greedy's candidate set.
            const sourceId = mayPaySourceInstanceId(state, head);
            const total = matching.reduce(
                (sum, c) =>
                    c.id === sourceId
                        ? sum
                        : sum + (tryGetDefinition(c.card.id)?.power ?? 0),
                0
            );
            if (total < norm.permanent.count.minTotalPower) return false;
        } else if (matching.length < norm.permanent.count) {
            return false;
        }
    }
    if (norm.hand && !assignMayPayHandCards(visibleHand(bot), norm.hand)) {
        // CR 701.9 / 118.9 — every requirement must be coverable by DISTINCT
        // hand cards matching ITS filter, run through the engine's ONE
        // assignment authority (the identical call `canPayMayPayCost` makes
        // server-side). The summed-count check this replaces (`hand.length >=
        // total`) reported a hand full of non-matching cards as AFFORDABLE, so
        // the bot accepted and the server's pay path then threw (PR #1963
        // review round 2).
        return false;
    }
    return true;
}

/** The payer's own hand cards as the projection carries them, nulls dropped.
 *  An opponent's hand projects to `null[]` (ADR 0026); the bot only ever prices
 *  its OWN may-pay hand leg, so an empty list there is the correct — and
 *  conservative — answer. */
function visibleHand(
    player: PublicGameState["players"][number]
): SlimCardInstance[] {
    return player.hand.filter((c): c is NonNullable<typeof c> => c !== null);
}

/** The instance id of the ability SOURCE behind a pending may-pay — the stack
 *  item's trigger source (`triggerSourceId`). Used to exclude the source from a
 *  CR 118 threshold-mode sacrifice pool: a "sacrifice it unless you sacrifice
 *  creatures with total power ≥ N" punisher (Phyrexian Dreadnought) lists its
 *  own source among the legal victims, but sacrificing it to pay is self-
 *  defeating — it destroys the permanent the payment is meant to keep, board-
 *  equivalent to declining. Undefined when no source is identifiable. */
function mayPaySourceInstanceId(
    state: PublicGameState,
    head: PendingChoice
): string | undefined {
    return state.stack.find((s) => s.id === head.stackItemId)?.triggerSourceId;
}

/** Surfaces the may-pay PERMANENT-leg pick shape for the bot's OwedChoice: a
 *  fixed `sacrificeCount` (CR 701.16b) or a summed-power `sacrificeThreshold`
 *  (CR 118, Phyrexian Dreadnought). Both absent when the cost has no permanent
 *  leg. Covers BOTH terminal actions (ADR 0079): a `"return"` leg picks exactly
 *  like a sacrifice leg — same candidate set, same fixed count, same
 *  `sacrificeIds` submit field — so the bot never stalls on one. It always
 *  reaches the fixed-count branch, because a `"return"` leg opens the picker
 *  unconditionally (`mayPaySacrificeChoiceRequired`) and never carries a
 *  threshold. */
function mayPaySacrificePick(head: PendingChoice): {
    sacrificeCount?: number;
    sacrificeThreshold?: number;
} {
    if (head.kind !== "may-pay" || head.zone !== "battlefield" || !head.cost) {
        return {};
    }
    const count = normalizeMayPayCost(head.cost).permanent?.count;
    if (count === undefined) return {};
    return typeof count === "object"
        ? { sacrificeThreshold: count.minTotalPower }
        : { sacrificeCount: count };
}

/** Surfaces the may-pay discard pick for the bot's OwedChoice (CR 701.9 /
 *  118.3, issue #899): the fixed `discardCount` the leg gives up, plus the
 *  CONCRETE `discardIds` the bot must submit. Mirrors {@link mayPaySacrificePick};
 *  discard has no summed-power threshold shape.
 *
 *  The ids are resolved HERE, not by slicing `discardCount` cards off the
 *  candidate union in the policy (PR #1963 review round 2). CR 118.9 — worst-
 *  first is a PREFERENCE, not the pick: the leg's per-requirement filters decide
 *  what is legal, and a top-N slice of the union is routinely illegal for a
 *  filtered multi-requirement leg (two creatures where the leg wants a creature
 *  AND an instant). The server's submit boundary rejects it, the driver catches,
 *  resets its signature and re-answers the same state forever — a bot freeze.
 *  Routing the ordering through {@link assignMayPayHandCards} — the same
 *  authority `mayPayHandSelectionLegal` validates against, and the same shape
 *  the search-side `choiceCandidates.ts` uses — guarantees a submission the
 *  server accepts. Absent when the leg cannot be covered at all, which
 *  `mayPayIsAffordable` has already turned into a decline. */
function mayPayDiscardPick(
    state: PublicGameState,
    head: PendingChoice,
    candidates: ChoiceCandidate[]
): {
    discardCount?: number;
    discardIds?: string[];
} {
    if (head.kind !== "may-pay" || head.zone !== "hand" || !head.cost) {
        return {};
    }
    const leg = normalizeMayPayCost(head.cost).hand;
    if (!leg) return {};
    const payer = state.players.find((p) => p.id === head.playerId);
    const preferred = [...candidates]
        .sort((a, b) => a.value - b.value)
        .map((c) => c.id);
    const chosen = payer
        ? assignMayPayHandCards(visibleHand(payer), leg, preferred)
        : undefined;
    return {
        discardCount: mayPayHandLegCount(head.cost),
        ...(chosen ? { discardIds: chosen.map((c) => c.id) } : {}),
    };
}

/** Project the active bot-owed `PendingChoice` into the {@link OwedChoice} the
 *  default policy reasons about. Skips `mulligan-bottom` (handled by the
 *  pre-game mulligan branch) and choices owed to another player. */
function buildOwedChoice(
    state: PublicGameState,
    botId: string
): OwedChoice | undefined {
    const head = state.pendingChoices?.[0];
    if (!head || head.playerId !== botId || head.kind === "mulligan-bottom") {
        return undefined;
    }
    const candidates = readChoiceZone(state, head, botId).map(toCandidate);
    // CR 115.4 — a `choose-damage-target` choice (Cuombajj Witches) admits
    // players as targets too. Players aren't in any zone, so append them from
    // the choice's `candidatePlayerIds` allow-list. Each player gets a neutral
    // value so the bot's worst-first default treats them like a low-value pick
    // (the bot is the opponent choosing; a minimal-legal pick suffices, ADR 0016).
    // `choose-player` (CR 115.1a — Endurance) is likewise a player pick with no
    // zone members, so its candidates come entirely from `candidatePlayerIds`.
    if (
        (head.kind === "choose-damage-target" ||
            head.kind === "choose-player") &&
        head.candidatePlayerIds
    ) {
        for (const pid of head.candidatePlayerIds) {
            candidates.push({ id: pid, value: 0 });
        }
    }
    // CR 614.12 — an `option-pick` choice (Primal Clay / Shapeshifter) picks
    // an abstract option id, not a zone member. The options aren't in any zone,
    // so append them from the choice's `options` list with a neutral value;
    // the bot's minimal-legal default (ADR 0016) takes the first.
    if (head.kind === "option-pick" && head.options) {
        for (const opt of head.options) {
            candidates.push({ id: opt.id, value: 0 });
        }
    }
    // ADR 0053 (pile division) — a `pick-pile` choice (step 2 of the
    // divide-then-choose family) picks the abstract label "A" or "B", not a
    // zone member. Append them as neutral-value synthetic candidates, like
    // `option-pick`'s options above.
    if (head.kind === "pick-pile") {
        candidates.push({ id: "A", value: 0 }, { id: "B", value: 0 });
    }
    // CR 603.3b (ADR 0058) — a `trigger-order` choice orders this bot's slice of
    // the off-stack trigger batch. The candidates aren't zone members; append
    // them from `candidateIds` (neutral value). The default policy emits the
    // slice in collection order — the bot's self-ordering is tactically
    // immaterial, so any legal permutation suffices (ADR 0058).
    if (head.kind === "trigger-order" && head.candidateIds) {
        for (const id of head.candidateIds) {
            candidates.push({ id, value: 0 });
        }
    }
    // CR 118 — for a threshold-mode may-pay sacrifice (Phyrexian Dreadnought),
    // drop the ability's own source from the pool the bot reasons over so the
    // greedy never self-sacrifices the permanent the payment keeps. The same
    // exclusion runs in `mayPayIsAffordable`, so accept/decline and the greedy
    // pick see one consistent candidate set.
    const sacrificePick = mayPaySacrificePick(head);
    const candidatesForChoice =
        head.kind === "may-pay" &&
        sacrificePick.sacrificeThreshold !== undefined
            ? candidates.filter(
                  (c) => c.id !== mayPaySourceInstanceId(state, head)
              )
            : candidates;

    return {
        kind: head.kind,
        // issue #1506 — is this an in-tree ISMCTS decision node the SEARCH must
        // answer, rather than the ADR 0016 heuristic? `isSearchableChoiceNode`
        // is the single authority (the same registry `enumerateMoves` and
        // `decidingPlayer` consult), and the parked-continuation guard mirrors
        // `enumerateMoves` exactly: with a cast / target / activation / companion
        // payment mid-flight the enumerator surfaces NO moves for a pending
        // choice, so routing to the Worker there would stall the bot. Keeping
        // the two conditions identical is what stops the gate and the enumerator
        // disagreeing.
        //
        // PR #1914 review finding 2 — the test is the WHOLE choice, not just its
        // kind: a registered generator may decline a particular choice
        // (`choose-hand-card` emits nothing for a MANDATORY `min > 0` pick, so
        // every Brainstorm putback / discard cost gated on bare kind membership
        // paid a Worker round-trip plus `THINK_DELAY_MS` and then landed on the
        // driver's emergency fallback).
        searchable:
            isSearchableChoiceNode(head) &&
            !state.pendingCast &&
            !state.pendingTarget &&
            !state.pendingActivation &&
            !state.pendingCompanionPay,
        min: getPendingChoiceMin(head.count),
        max: getPendingChoiceMax(head.count),
        candidates: candidatesForChoice,
        affordable:
            head.kind === "may-pay" || head.kind === "land-entry-tapped"
                ? mayPayIsAffordable(state, head, botId)
                : undefined,
        // CR 701.16b — a may-pay sacrifice leg with a real victim choice sets
        // `zone: "battlefield"` and lists the legal victims in `candidateIds`;
        // surface EITHER the fixed count the payer must pick (`sacrificeCount`)
        // OR the summed-power threshold (`sacrificeThreshold`, CR 118, Phyrexian
        // Dreadnought) so the bot supplies a legal `sacrificeIds`. Both undefined
        // for a plain yes/no or auto-resolving pay.
        ...sacrificePick,
        // CR 701.9 / 118.3 (issue #899) — a may-pay discard leg with a real card
        // choice sets `zone: "hand"` and lists the legal hand cards in
        // `candidateIds`; surfaces the fixed count the payer must pick
        // (`discardCount`) AND the concrete, per-requirement-legal `discardIds`
        // the bot submits. Undefined for a plain yes/no or auto-resolving pay.
        ...mayPayDiscardPick(state, head, candidatesForChoice),
        // issue #1364 (Atraxa) / #1945 (Noxious Vapors, Planar Overlay) — a
        // CATEGORIZED pick constrains the keep beyond the count bounds (at
        // most one member per category, each claimable by only one), so the
        // policy must test each addition rather than blindly take `max`
        // best-valued members; an over-picked submission is rejected
        // server-side, which freezes the bot. `choose-categorized` is
        // `look-distribute`'s hand/battlefield sibling (same `categories`
        // shape, `gre/categorizedPick.ts`'s bipartite legality) — both route
        // through the SAME `chooseResolution` branch (`brain.ts`). Undefined
        // for an ordinary dig / any other kind.
        categories:
            head.kind === "look-distribute" ||
            head.kind === "choose-categorized"
                ? head.categories
                : undefined,
        // issue #1945 — the two extra signals a `choose-categorized` pick
        // carries, both invisible in `categories` alone and both required for
        // a LEGAL, non-self-harming answer:
        //   `categoryRule: "cover"` — the submission must answer EVERY
        //     non-empty category (a partial answer is rejected server-side →
        //     bot freeze, the recurring "bot stalls on a new choice mechanic"
        //     class).
        //   `pickPolarity` — whether the picks are the half the chooser KEEPS
        //     (Noxious Vapors) or the half it LOSES (Planar Overlay's
        //     bounce). Without it the shared branch ranks a bounce "best
        //     first" and the bot returns its two best lands.
        // Both are undefined for `look-distribute` and every other kind, so
        // that branch keeps its pre-#1945 behaviour exactly.
        categoryRule:
            head.kind === "choose-categorized" ? head.categoryRule : undefined,
        pickPolarity:
            head.kind === "choose-categorized" ? head.pickPolarity : undefined,
        // issue #242 — the discard heuristic needs the board's mana picture to
        // protect scarce lands and rank spells by castability.
        manaSituation:
            head.kind === "discard-hand"
                ? buildManaSituation(state, botId)
                : undefined,
        // CR 202.3 — name-a-card default. Name the chooser's own top library
        // card when the bot can see it (the bot is the chooser; Petra Sphinx
        // names to dig the top into hand), else a guaranteed-registered
        // fallback ("Plains"). Validated server-side against the registry.
        nameCardDefault:
            head.kind === "name-card"
                ? nameCardDefaultFor(state, head)
                : undefined,
    };
}

/** The bot's default named card for a `name-card` choice (CR 202.3). Prefers
 *  the chooser's own top library card name when it is visible to the bot in the
 *  projection (the bot is the chooser), so a self-targeted Petra Sphinx digs the
 *  top into hand. Falls back to "Plains" (always registered) when the top is
 *  hidden or unknown. */
function nameCardDefaultFor(
    state: PublicGameState,
    head: PendingChoice
): string {
    const owner = state.players.find((p) => p.id === head.playerId);
    // The projected library is sparse (ADR 0026): `{ count, known }` carrying
    // only cards the viewer knows, each at its top-relative `index`. The top
    // card is the known entry at index 0 when present.
    const lib = owner?.library;
    const top =
        lib && !Array.isArray(lib)
            ? lib.known.find((k) => k.index === 0)?.card
            : undefined;
    // `top` is a slim instance; its DEFINITION id lives at `top.card.id`.
    const defId = top?.card?.id;
    const def = defId ? tryGetDefinition(defId) : undefined;
    return def?.name ?? "Plains";
}

/** Project the bot-viewpoint `PublicGameState` into the gate's decision window.
 *  Pure: reads only the bot's own (visible) hand and the public mulligan /
 *  combat / priority fields. */
export function buildBotView(state: PublicGameState, botId: string): BotView {
    const combat = state.combat;
    const view: BotView = {
        botId,
        phase: state.phase ?? "UPKEEP",
        priorityPlayerId: state.priorityPlayerId ?? state.activePlayerId,
        activePlayerId: state.activePlayerId,
        hasCombat: combat !== undefined,
        attackersConfirmed: combat?.confirmed === true,
        blockersConfirmed: combat?.blockersConfirmed === true,
        damageConfirmed: combat?.damageConfirmed,
        botOwesDamageConfirm: botOwesDamageConfirm(combat, botId),
        mulliganDeclaringId: state.mulligan?.declaringPlayerId,
        mulliganBottoming: state.mulligan?.bottoming === true,
        gameOver: state.gameOver !== undefined,
    };

    // CR 508.1c/1g — the parked per-attacker MANA attack tax (Propaganda /
    // Collective Restraint). When the bot is the payer, gate on whether it can
    // plausibly cover the (generic-only) tax from its pool plus untapped mana
    // sources, so the driver pays when it can and cancels the declaration when
    // it can't (rather than looping on a locked declaration).
    const tax = combat?.pendingAttackManaTax;
    if (tax && tax.playerId === botId) {
        view.attackManaTaxOwed = true;
        const bot = state.players.find((p) => p.id === botId);
        const pool = bot?.manaPool ?? {};
        const poolTotal = Object.values(pool).reduce(
            (a, v) => a + (typeof v === "number" ? v : 0),
            0
        );
        // Untapped lands as a conservative available-mana proxy (attack taxes
        // are all {N}); the server's auto-tap does the real solving.
        const untappedSources = (bot?.battlefield ?? []).filter(
            (c) => !c.isTapped && (c.types ?? []).includes("Land")
        ).length;
        const cost = tax.cost;
        const need =
            (typeof cost.generic === "number" ? cost.generic : 0) +
            (typeof cost.X === "number" ? cost.X : 0) +
            (["W", "U", "B", "R", "G", "C"] as const).reduce((a, k) => {
                const v = cost[k];
                return a + (typeof v === "number" ? v : 0);
            }, 0);
        view.attackManaTaxAffordable = poolTotal + untappedSources >= need;
    }

    // Mulligan window: expose the bot's hand (land flags) and counts so the
    // gate can run the land-count keep/mull heuristic and the bottom-N pick.
    if (state.phase === "MULLIGAN" && state.mulligan) {
        const myIndex = state.players.findIndex((p) => p.id === botId);
        if (myIndex !== -1) {
            view.mulligansTaken = state.mulligan.mulligansTaken[myIndex] ?? 0;
            view.mulliganHand = state.players[myIndex].hand
                .filter((c): c is NonNullable<typeof c> => c !== null)
                .map((c) => ({ id: c.id, isLand: handCardIsLand(c.types) }));
        }
        const head = state.pendingChoices?.[0];
        if (
            head &&
            head.kind === "mulligan-bottom" &&
            head.playerId === botId
        ) {
            view.mulliganBottomCount =
                typeof head.count === "number" ? head.count : head.count.max;
        }
    }

    // Mid-resolution interactive choice owed to the bot (ADR 0016) — surfaced
    // for ANY bot-owed head choice except `mulligan-bottom` (handled above).
    view.owedChoice = buildOwedChoice(state, botId);

    // CR 601.2g (issue #1444/#1446) — the parked generic-mana spend choice.
    view.manaSpendChoice = buildManaSpendChoiceView(state, botId);

    // CR 601.2g / 702.66 (issue #1336) — the parked cast-cost graveyard exile
    // picker (delve; flashback / escape exile costs).
    view.castExileChoice = buildCastExileChoiceView(state, botId);
    view.convokeChoice = buildConvokeChoiceView(state, botId);

    return view;
}

/** Translate a brain-resolved gate decision into the `Move` the executor
 *  realises (issue #145, generalised for ADR 0016). These are the windows the
 *  cheap main-thread layer resolves WITHOUT the Worker search: mulligan
 *  keep/mull/bottom and any mid-resolution choice default. Returns null when the
 *  action is not one of those, or when the choice identity can't be read from
 *  the active pending choice. */
export function botActionToMove(
    action: BotAction,
    state: PublicGameState,
    botId: string
): Move | null {
    // EXHAUSTIVE over `BotAction["kind"]` (`assertNever` default): every
    // executor-realised kind (see `botActionRealisation`) MUST produce a Move
    // here, so a new choice mechanic cannot compile while leaving its executor
    // action untranslatable — the second half of the guard against the "bot
    // freezes on a new choice mechanic" class. Worker/none/confirm kinds never
    // reach this translator (the driver realises them elsewhere) and return null.
    switch (action.kind) {
        case "keep":
        case "mull":
            return { kind: "mulligan", decision: action.kind };
        case "mulligan-bottom": {
            const head = state.pendingChoices?.[0];
            if (
                !head ||
                head.kind !== "mulligan-bottom" ||
                head.playerId !== botId
            ) {
                return null;
            }
            return {
                kind: "mulligan-bottom",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: action.cardInstanceIds,
            };
        }
        case "resolution-choice": {
            const head = state.pendingChoices?.[0];
            if (
                !head ||
                head.playerId !== botId ||
                head.kind === "mulligan-bottom"
            ) {
                return null;
            }
            return {
                kind: "resolution-choice",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: action.cardInstanceIds,
            };
        }
        case "may-pay": {
            // Routes through `submitMayPay`, not `submitResolutionChoice`. The
            // boolean is all the executor needs; the server reads the head choice.
            const head = state.pendingChoices?.[0];
            if (!head || head.kind !== "may-pay" || head.playerId !== botId) {
                return null;
            }
            return {
                kind: "may-pay",
                accept: action.accept,
                ...(action.sacrificeIds
                    ? { sacrificeIds: action.sacrificeIds }
                    : {}),
                // CR 701.9 / 118.3 (issue #899 / #1507) — a discard-leg pick
                // must travel alongside `sacrificeIds` or the submit throws
                // ("select cards to discard") and the driver loops forever
                // re-answering the same choice.
                ...(action.discardIds ? { discardIds: action.discardIds } : {}),
            };
        }
        case "land-entry": {
            // CR 614.12 / ADR 0051 — shock land: routes through
            // `submitLandEntryChoice`. Only the boolean travels; the server
            // reads the head choice.
            const head = state.pendingChoices?.[0];
            if (
                !head ||
                head.kind !== "land-entry-tapped" ||
                head.playerId !== botId
            ) {
                return null;
            }
            return { kind: "land-entry", accept: action.accept };
        }
        case "draw-replacement": {
            // CR 614 / issue #735 — Zur's Weirding: routes through
            // `submitDrawReplacementPay`. Only the boolean travels; the server reads
            // the head choice.
            const head = state.pendingChoices?.[0];
            if (
                !head ||
                head.kind !== "draw-replacement" ||
                head.playerId !== botId
            ) {
                return null;
            }
            return { kind: "draw-replacement", accept: action.accept };
        }
        case "name-card": {
            // CR 202.3 — routes through `submitNameCard`. Only the name travels;
            // the server reads the head choice and validates the name.
            const head = state.pendingChoices?.[0];
            if (!head || head.kind !== "name-card" || head.playerId !== botId) {
                return null;
            }
            return { kind: "name-card", cardName: action.cardName };
        }
        case "random-reveal-ack": {
            // CR 705.2 / ADR 0023 — routes through `submitRandomRevealAck`. No
            // data travels; the choice identity is read from the active head.
            const head = state.pendingChoices?.[0];
            if (
                !head ||
                head.kind !== "random-reveal" ||
                head.playerId !== botId
            ) {
                return null;
            }
            return {
                kind: "random-reveal-ack",
                stackItemId: head.stackItemId,
                choiceId: head.choiceId,
            };
        }
        case "madness-decline": {
            // CR 702.35d — routes through `submitMadnessDecline` (decline the
            // reflexive Madness cast-choice → graveyard). No data travels; the
            // server reads the head choice and validates it.
            const head = state.pendingChoices?.[0];
            if (
                !head ||
                head.kind !== "madness-cast" ||
                head.playerId !== botId
            ) {
                return null;
            }
            return { kind: "madness-decline" };
        }
        case "rebound-decline": {
            // CR 702.88c — routes through `submitReboundDecline` (decline the
            // reflexive Rebound cast-choice — the card remains exiled). No
            // data travels; the server reads the head choice and validates it.
            const head = state.pendingChoices?.[0];
            if (
                !head ||
                head.kind !== "rebound-cast" ||
                head.playerId !== botId
            ) {
                return null;
            }
            return { kind: "rebound-decline" };
        }
        // Realised by the driver directly (Worker search / confirmDamage /
        // attack-tax pay-cancel / no-op), never translated to a Move here.
        // `search-choice` in particular carries no answer of its own — the
        // Worker's returned Move IS the submission (issue #1506).
        // `cast-exile-cost` (CR 601.2g / 702.66, issue #1336) and
        // `convoke-creatures` (CR 702.51, issue #1338) likewise: the parked
        // cast-cost pickers hang off `pendingCast`, not `pendingChoices[]`, so
        // they are driven straight through `selectCastExileCost` /
        // `selectConvokeCreatures` and have no Move to translate into.
        case "search-choice":
        case "pass":
        case "declare-attackers":
        case "declare-blockers":
        case "confirm-combat-damage":
        case "pay-attack-tax":
        case "cancel-attack-tax":
        case "resolve-mana-spend":
        case "cast-exile-cost":
        case "convoke-creatures":
        case "none":
            return null;
        default:
            return assertNever(action);
    }
}

/** Compile-time exhaustiveness guard for the `botActionToMove` switch. */
function assertNever(x: never): never {
    throw new Error(`Unhandled BotAction: ${JSON.stringify(x)}`);
}
