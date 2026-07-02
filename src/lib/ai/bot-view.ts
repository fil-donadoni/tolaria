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
    normalizeMayPayCost,
} from "@convex/gre";
import { cardValueById } from "@convex/gre";
import { manaValue } from "@convex/gre/constants";
import { matchesPermanentFilter } from "@convex/cards/filters";
import { getColorsFromCost, getCardColors } from "@convex/cards/colors";
import { tryGetDefinition } from "@convex/cards";
import type { Color } from "@convex/cards/types";
import type {
    BotAction,
    BotView,
    ChoiceCandidate,
    ManaSituation,
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
    };
}

/** Distinct colors the controller's lands in play can currently produce
 *  (issue #242). Reads the bot's visible battlefield: each land's
 *  color-identity (`getCardColors` — basic subtypes + declared mana abilities)
 *  contributes to the producible set. A spell needing a color outside this set
 *  is "uncastable" for the discard ranking. */
function producibleColors(battlefield: SlimCardInstance[]): Color[] {
    const set = new Set<Color>();
    for (const perm of battlefield) {
        if (!handCardIsLand(perm.types)) continue;
        const def = tryGetDefinition(perm.card.id);
        if (!def) continue;
        for (const c of getCardColors(def)) set.add(c);
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
                        },
                        filter
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
        default:
            return [];
    }

    if (head.candidateIds) {
        const allow = new Set(head.candidateIds);
        cards = cards.filter((c) => allow.has(c.id));
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
    if (norm.sacrifice) {
        const have = bot.battlefield.filter((c) =>
            matchesPermanentFilter(c, norm.sacrifice!.filter)
        ).length;
        if (have < norm.sacrifice.count) return false;
    }
    return true;
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
    if (head.kind === "choose-damage-target" && head.candidatePlayerIds) {
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
    return {
        kind: head.kind,
        min: getPendingChoiceMin(head.count),
        max: getPendingChoiceMax(head.count),
        candidates,
        affordable:
            head.kind === "may-pay"
                ? mayPayIsAffordable(state, head, botId)
                : undefined,
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
    if (action.kind === "keep" || action.kind === "mull") {
        return { kind: "mulligan", decision: action.kind };
    }
    if (action.kind === "mulligan-bottom") {
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
    if (action.kind === "resolution-choice") {
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
    if (action.kind === "may-pay") {
        // Routes through `submitMayPay`, not `submitResolutionChoice`. The
        // boolean is all the executor needs; the server reads the head choice.
        const head = state.pendingChoices?.[0];
        if (!head || head.kind !== "may-pay" || head.playerId !== botId) {
            return null;
        }
        return { kind: "may-pay", accept: action.accept };
    }
    if (action.kind === "name-card") {
        // CR 202.3 — routes through `submitNameCard`. Only the name travels;
        // the server reads the head choice and validates the name.
        const head = state.pendingChoices?.[0];
        if (!head || head.kind !== "name-card" || head.playerId !== botId) {
            return null;
        }
        return { kind: "name-card", cardName: action.cardName };
    }
    if (action.kind === "random-reveal-ack") {
        // CR 705.2 / ADR 0023 — routes through `submitRandomRevealAck`. No
        // data travels; the choice identity is read from the active head.
        const head = state.pendingChoices?.[0];
        if (!head || head.kind !== "random-reveal" || head.playerId !== botId) {
            return null;
        }
        return {
            kind: "random-reveal-ack",
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        };
    }
    return null;
}
