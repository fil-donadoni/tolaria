// The AI Bot's Brain gate — the pure "does the bot owe an action?" check
// (ADR 0001, issues #109–#111).
//
// `BotView` / `decideBotAction` are the cheap main-thread GATE: a constant-time
// look at the current window that decides whether the bot owes any action at all
// before paying for a Worker round-trip. The actual move CHOICE lives in the GRE
// (`search` — issue #112: ISMCTS over a determinized tree, scored by `evaluate`;
// it supersedes the greedy 1-ply selector of #111), which the Worker
// (`brain.worker.ts`) runs off the UI thread. Both layers are pure and tested
// without a browser; this file is the gate only.
//
// Mid-resolution interactive choices (ADR 0016) are the exception that, like the
// mulligan heuristic, is resolved RIGHT HERE on the main thread rather than in
// the search: while `pendingChoices` is non-empty the GRE deliberately surfaces
// no move (`enumerateMoves` → [], `decidingPlayer` → null), so the bot would
// freeze. `chooseResolution` gives the bot a weak-but-legal default for every
// `PendingChoiceKind` so the game always advances; smart selection is deferred to
// the evaluation work (ADR 0016).

import type { PendingChoiceKind } from "@convex/gre";

/** The minimal slice of game state the bot needs to decide. Built on the
 *  driving client from the full state (the bot's hand is visible to the human's
 *  process — accepted, vs-AI is single-player; see ADR 0001). For the pass-only
 *  bot only the current decision WINDOW matters, not card contents. */
export type BotView = {
    /** The seat the bot controls (`${userId}-p2`). */
    botId: string;
    phase: string;
    priorityPlayerId: string;
    activePlayerId: string;
    /** Whether a combat is in progress and its declaration flags. */
    hasCombat: boolean;
    attackersConfirmed: boolean;
    blockersConfirmed: boolean;
    /** Mulligan declaration window (pre-game). */
    mulliganDeclaringId?: string;
    /** True while ANY player is bottoming cards after a mulligan (CR 103.5).
     *  Combined with `mulliganBottomCount` to tell whose turn it is. */
    mulliganBottoming?: boolean;
    /** The bot's opening hand while a mulligan decision (declaration or
     *  bottoming) is owed — `id` + `isLand` per card, enough for the
     *  land-count keep/mull heuristic and the bottom-N selection. */
    mulliganHand?: { id: string; isLand: boolean }[];
    /** Mulligans the bot has already taken this game (CR 103.5). Drives the
     *  keep floor and is the count of cards to bottom on keep. */
    mulligansTaken?: number;
    /** Number of cards the bot must put on the bottom of its library right now
     *  — set only when the active bottoming choice belongs to the bot, else
     *  undefined (some other player is bottoming, or nobody is). */
    mulliganBottomCount?: number;
    /** True once the game has ended — the bot must not act. */
    gameOver?: boolean;
    /** A mid-resolution interactive choice owed to the bot (ADR 0016), already
     *  projected into the minimal shape the default-selection policy needs.
     *  Surfaced for any bot-owed `pendingChoices[0]` EXCEPT `mulligan-bottom`,
     *  which the pre-game mulligan branch handles via its own hand heuristic.
     *  Undefined when no choice is owed. */
    owedChoice?: OwedChoice;
};

/** A choosable card as the bot sees it on its projected view — enough for the
 *  trivial material ordering the weak-but-legal defaults use (ADR 0016). */
export type ChoiceCandidate = {
    id: string;
    /** Lands rank lowest in the material ordering (a spell is worth more than a
     *  land to dig out / keep mid-game). */
    isLand: boolean;
};

/** The interactive choice the bot is owed this window (ADR 0016), reduced to the
 *  fields `chooseResolution` reasons about. Built by `buildBotView` from the
 *  active `PendingChoice` and the bot's visible zones. */
export type OwedChoice = {
    kind: PendingChoiceKind;
    /** Normalized count bounds (`getPendingChoiceMin` / `getPendingChoiceMax`):
     *  the submission must pick between `min` and `max` ids inclusive. */
    min: number;
    max: number;
    /** Legal candidate cards in zone order. Empty for `may-pay` (a yes/no with
     *  no card selection). */
    candidates: ChoiceCandidate[];
    /** `may-pay` only: whether the optional cost is trivially affordable from the
     *  bot's available mana (ADR 0016 minimal policy: accept iff affordable). */
    affordable?: boolean;
};

/** A bot decision, realised by the executor through EXISTING mutations only
 *  (no new move surface — issue #109 / ADR 0001):
 *   - `keep`              → `declareMulligan({ decision: "keep" })`
 *   - `mull`              → `declareMulligan({ decision: "mull" })`
 *   - `mulligan-bottom`   → `submitResolutionChoice` (kind "mulligan-bottom")
 *   - `resolution-choice` → `submitResolutionChoice` (any zone-pick kind, ADR 0016)
 *   - `may-pay`           → `submitMayPay` (yes-no family, ADR 0016)
 *   - `declare-attackers` → `confirmAttackers` (empty selection = no attack)
 *   - `declare-blockers`  → `confirmBlockers` (empty selection = no block)
 *   - `pass`              → `passPriority`
 *   - `none`              → the bot owes no action right now; do nothing. */
export type BotAction =
    | { kind: "keep" }
    | { kind: "mull" }
    | { kind: "mulligan-bottom"; cardInstanceIds: string[] }
    | { kind: "resolution-choice"; cardInstanceIds: string[] }
    | { kind: "may-pay"; accept: boolean }
    | { kind: "declare-attackers" }
    | { kind: "declare-blockers" }
    | { kind: "pass" }
    | { kind: "none" };

const NONE: BotAction = { kind: "none" };

/** Strategic mulligan floor: once the bot has taken this many mulligans it
 *  keeps whatever it draws rather than digging further into card disadvantage
 *  (CR 103.5 hard-locks at a 0-card hand; this is the bot's softer cap). */
export const MULLIGAN_FLOOR = 3;

/** Land-count keep/mull heuristic (issue #145). Deterministic and pure. Mulls a
 *  hand with no lands or no spells; keeps everything else, and always keeps once
 *  the mulligan floor is reached. Curve / colour evaluation is out of scope. */
function decideMulligan(view: BotView): BotAction {
    if ((view.mulligansTaken ?? 0) >= MULLIGAN_FLOOR) return { kind: "keep" };
    const hand = view.mulliganHand ?? [];
    const lands = hand.filter((c) => c.isLand).length;
    const spells = hand.length - lands;
    if (lands === 0 || spells === 0) return { kind: "mull" };
    return { kind: "keep" };
}

/** Choose which `count` cards to put on the bottom after a mulligan keep
 *  (CR 103.5). Heuristic: shed excess lands first (aiming to keep ~40% lands in
 *  the final hand, at least one), then the trailing spells; deterministic by
 *  hand order. Returns exactly `count` ids (or all of them if `count` exceeds
 *  the hand). */
export function chooseMulliganBottoms(
    hand: { id: string; isLand: boolean }[],
    count: number
): string[] {
    if (count <= 0) return [];
    if (count >= hand.length) return hand.map((c) => c.id);

    const lands = hand.filter((c) => c.isLand);
    const spells = hand.filter((c) => !c.isLand);
    const keep = hand.length - count;
    const targetKeepLands = Math.min(
        lands.length,
        Math.max(keep > 0 ? 1 : 0, Math.round(keep * 0.4))
    );
    let landsToBottom = Math.min(
        count,
        Math.max(0, lands.length - targetKeepLands)
    );

    const bottoms: string[] = [];
    // Excess lands, taken from the back of the hand for a stable order.
    for (let i = lands.length - 1; i >= 0 && landsToBottom > 0; i--) {
        bottoms.push(lands[i].id);
        landsToBottom--;
    }
    // Fill the rest with trailing spells.
    for (let i = spells.length - 1; i >= 0 && bottoms.length < count; i--) {
        bottoms.push(spells[i].id);
    }
    // Fallback: if spells ran out, bottom remaining lands.
    for (let i = 0; i < lands.length && bottoms.length < count; i++) {
        if (!bottoms.includes(lands[i].id)) bottoms.push(lands[i].id);
    }
    return bottoms.slice(0, count);
}

/** Compile-time exhaustiveness guard (ADR 0016 criterion): adding a new
 *  `PendingChoiceKind` without a `chooseResolution` case makes `kind` non-`never`
 *  here and fails the build, so no future choice kind can silently freeze the
 *  bot. */
function assertNever(x: never): never {
    throw new Error(`Unhandled PendingChoiceKind: ${String(x)}`);
}

/** The bot's weak-but-legal default for a mid-resolution choice (ADR 0016).
 *  Returns the card-instance ids to submit through `submitResolutionChoice`.
 *  Pure and deterministic. The switch is EXHAUSTIVE over `PendingChoiceKind`:
 *  unimplemented kinds throw loudly (issues #164/#165 fill them) rather than
 *  return an illegal/empty pick that the server would reject back into a freeze.
 *
 *  Quality is explicitly deferred to the evaluation work — the picks here are
 *  the minimal legal action, not the best one. */
export function chooseResolution(choice: OwedChoice): string[] {
    const { kind } = choice;
    switch (kind) {
        case "search-library": {
            // Fetch the required count, preferring non-lands (higher material)
            // and falling back to lands, in zone order. `Array.sort` is stable,
            // so the pick is deterministic. Smart tutor targeting is deferred.
            const ordered = [...choice.candidates].sort(
                (a, b) => Number(a.isLand) - Number(b.isLand)
            );
            return ordered.slice(0, choice.min).map((c) => c.id);
        }

        // `may-pay` is a yes/no answer (not a card pick) routed through
        // `submitMayPay`; `decideBotAction` handles it before reaching here, and
        // `mulligan-bottom` has its own pre-game branch. Reaching either via
        // `chooseResolution` is a programming error.
        case "may-pay":
        case "mulligan-bottom":
            throw new Error(
                `chooseResolution: "${kind}" is not resolved here (use the dedicated path)`
            );

        // Not yet implemented — #165 fills the remaining zone-pick + modal
        // kinds. Each throws so the gap is loud, never a silent freeze.
        case "keep-permanents":
        case "sacrifice-permanents":
        case "keep-hand":
        case "pick-source":
        case "untap-pick":
        case "discard-hand":
        case "reorder-library":
        case "reveal-hand":
        case "choose-permanents":
        case "partition":
        case "choose-hand-card":
            throw new Error(
                `chooseResolution: default policy not yet implemented for "${kind}"`
            );

        default:
            return assertNever(kind);
    }
}

/** Decide the bot's action for the current window. Returns `none` when it is not
 *  the bot's turn to act. Deterministic and side-effect free. */
export function decideBotAction(view: BotView): BotAction {
    if (view.gameOver) return NONE;

    // Pre-game mulligan (CR 103.5, London mulligan).
    if (view.phase === "MULLIGAN") {
        // Bottoming: act only when the active bottoming choice is the bot's.
        if (view.mulliganBottomCount !== undefined) {
            return {
                kind: "mulligan-bottom",
                cardInstanceIds: chooseMulliganBottoms(
                    view.mulliganHand ?? [],
                    view.mulliganBottomCount
                ),
            };
        }
        if (view.mulliganBottoming) return NONE;
        // Declaration: evaluate keep vs mull via the land-count heuristic.
        if (view.mulliganDeclaringId === view.botId) {
            return decideMulligan(view);
        }
        return NONE;
    }

    // Mid-resolution interactive choice (ADR 0016): resolve any owed choice with
    // a legal default. A non-empty `pendingChoices` freezes priority and
    // suppresses every other move, so this precedes combat and the ordinary
    // priority pass — otherwise the bot would `pass` into a server no-op and
    // hang the game.
    if (view.owedChoice) {
        const choice = view.owedChoice;
        if (choice.kind === "may-pay") {
            // Yes/no family: accept only when the cost is trivially affordable
            // from the bot's mana pool, else decline (ADR 0016 minimal policy —
            // smart "should I pay?" is deferred). Both answers are legal.
            return { kind: "may-pay", accept: choice.affordable === true };
        }
        return {
            kind: "resolution-choice",
            cardInstanceIds: chooseResolution(choice),
        };
    }

    // Combat declarations are gated before priority can pass (the server
    // rejects passPriority until they are confirmed), so handle them first.
    if (
        view.phase === "DECLARE_ATTACKERS" &&
        view.hasCombat &&
        !view.attackersConfirmed &&
        view.activePlayerId === view.botId
    ) {
        return { kind: "declare-attackers" };
    }
    if (
        view.phase === "DECLARE_BLOCKERS" &&
        view.hasCombat &&
        !view.blockersConfirmed &&
        view.activePlayerId !== view.botId
    ) {
        // Defender is the non-active player; in a 2-player game that is the bot
        // whenever the human is active.
        return { kind: "declare-blockers" };
    }

    // Ordinary priority window.
    if (view.priorityPlayerId === view.botId) return { kind: "pass" };

    return NONE;
}
