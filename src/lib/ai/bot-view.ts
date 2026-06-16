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
import { getPendingChoiceMin, getPendingChoiceMax } from "@convex/gre";
import type { BotAction, BotView, ChoiceCandidate, OwedChoice } from "./brain";

/** Land detection on a projected hand card. The slim instance keeps the
 *  `types` array from `CardInstanceState` (only `card` is stripped), so a land
 *  is any card whose printed types include "Land" (CR 305.1). */
function handCardIsLand(types: string[] | undefined): boolean {
    return (types ?? []).includes("Land");
}

/** Map a slim card the bot can see into a {@link ChoiceCandidate} for the
 *  default-selection policy (just id + land flag for the material ordering). */
function toCandidate(card: SlimCardInstance): ChoiceCandidate {
    return { id: card.id, isLand: handCardIsLand(card.types) };
}

/** Read the cards the bot may legally pick for `head` from its projected view.
 *  The wire projection already exposes the relevant zone to the chooser
 *  (`librarySearch` for search, `libraryPeek` for reorder, `revealedHand` for
 *  reveal, the bot's own visible hand/battlefield otherwise — see
 *  `projectPublicState`). Returns [] for choices that pick from no zone
 *  (`may-pay`). Battlefield `filter` narrowing is deferred to issue #165; the
 *  `candidateIds` allow-list is applied here since it's a cheap id check. */
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
    return {
        kind: head.kind,
        min: getPendingChoiceMin(head.count),
        max: getPendingChoiceMax(head.count),
        candidates: readChoiceZone(state, head, botId).map(toCandidate),
    };
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
    return null;
}
