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
};

/** A bot decision, realised by the executor through EXISTING mutations only
 *  (no new move surface — issue #109 / ADR 0001):
 *   - `keep`              → `declareMulligan({ decision: "keep" })`
 *   - `mull`              → `declareMulligan({ decision: "mull" })`
 *   - `mulligan-bottom`   → `submitResolutionChoice` (kind "mulligan-bottom")
 *   - `declare-attackers` → `confirmAttackers` (empty selection = no attack)
 *   - `declare-blockers`  → `confirmBlockers` (empty selection = no block)
 *   - `pass`              → `passPriority`
 *   - `none`              → the bot owes no action right now; do nothing. */
export type BotAction =
    | { kind: "keep" }
    | { kind: "mull" }
    | { kind: "mulligan-bottom"; cardInstanceIds: string[] }
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
