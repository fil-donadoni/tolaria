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
    /** Combat-damage assignment flag (`combat.damageConfirmed`): `false` while a
     *  multi-block step waits for manual assignment + confirmation, `undefined`
     *  when damage auto-applied or no damage step is open. The server rejects a
     *  `passPriority` while it is `false`, so the bot must confirm instead of
     *  pass (else it loops on the rejection). */
    damageConfirmed?: boolean;
    /** True when a damage step is open (`damageConfirmed === false`), the bot is
     *  one of the step's assigners (CR 702.21j-k — normally the active player,
     *  banding can shift it), and it has NOT yet confirmed its portion. The bot
     *  owes a `confirmDamage`; cleared once it has confirmed so it doesn't loop
     *  re-confirming while waiting on another assigner. */
    botOwesDamageConfirm?: boolean;
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

/** A choosable card as the bot sees it on its projected view (ADR 0016). Carries
 *  a projected latent `value` (the shared `cardValue` primitive, ADR 0018,
 *  issue #197) so `chooseResolution` orders by real card worth — fetch/keep the
 *  best, sacrifice/discard the worst — instead of a single is-a-land bit. The
 *  `value` lives ONLY on this bot-only owed-choice path; it is never wired into
 *  the 2-player public projection, so it can't leak per-card valuations of a
 *  hidden hand in real PvP. */
export type ChoiceCandidate = {
    id: string;
    /** Projected latent Forge-scale worth (higher = keep / fetch; lower =
     *  sacrifice / discard). A land ranks lowest, a bomb highest. */
    value: number;
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
 *   - `confirm-combat-damage` → `confirmDamage` (default assignment, multi-block)
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
    | { kind: "confirm-combat-damage" }
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

/** Order candidates by projected card `value` (ADR 0018): `bestFirst` highest
 *  worth first (fetch / keep these), `worstFirst` lowest first (sacrifice /
 *  discard these). Stable `Array.sort` keeps zone order on ties, so every pick
 *  stays deterministic. */
function bestFirst(candidates: ChoiceCandidate[]): ChoiceCandidate[] {
    return [...candidates].sort((a, b) => b.value - a.value);
}
function worstFirst(candidates: ChoiceCandidate[]): ChoiceCandidate[] {
    return [...candidates].sort((a, b) => a.value - b.value);
}

/** The bot's weak-but-legal default for a mid-resolution zone-pick choice
 *  (ADR 0016). Returns the card-instance ids to submit through
 *  `submitResolutionChoice`. Pure and deterministic. The switch is EXHAUSTIVE
 *  over `PendingChoiceKind`; adding a kind without a case fails the build
 *  (`assertNever`) so no future choice can silently freeze the bot.
 *
 *  Every branch returns a count within `[min, max]` of candidates the server
 *  will accept (the candidate set is already zone/filter/allow-list filtered in
 *  `buildBotView`). Quality is explicitly deferred to the evaluation work —
 *  these are minimal legal actions, not the best ones. */
export function chooseResolution(choice: OwedChoice): string[] {
    const { kind, candidates, min } = choice;
    switch (kind) {
        // Keep / fetch the best `min` (non-lands first): the chooser retains
        // these and the rest are sacrificed / discarded / left behind.
        case "search-library":
        case "keep-permanents":
        case "keep-hand":
            return bestFirst(candidates)
                .slice(0, min)
                .map((c) => c.id);

        // Shed the worst `min` (lands first): the submission is what gets
        // sacrificed / discarded.
        case "sacrifice-permanents":
        case "discard-hand":
            return worstFirst(candidates)
                .slice(0, min)
                .map((c) => c.id);

        // Neutral pick of exactly `min` legal candidates in zone order. For the
        // range kinds `min` is 0 (CR 502.1 untap cap is permissive; "up to"
        // partitions; optional Illusionary Mask), so these resolve to an empty,
        // always-legal submission.
        case "choose-permanents":
        case "pick-source":
        case "choose-hand-card":
        case "untap-pick":
        case "partition":
            return candidates.slice(0, min).map((c) => c.id);

        // "Any target of an opponent's choice" (CR 115.4, Cuombajj Witches):
        // the bot is the opponent picking where 1 damage lands. Minimal-legal
        // default (ADR 0016) — pick exactly `min` (=1) by lowest projected
        // value, so it tends to ping the least valuable target (a player or a
        // small creature) rather than its own bomb. Smart targeting is deferred.
        case "choose-damage-target":
            return worstFirst(candidates)
                .slice(0, min)
                .map((c) => c.id);

        // Reveal-hand only acknowledges (count 0) — submit nothing.
        case "reveal-hand":
            return [];

        // Scry / reorder (CR 401.4): keep the best on top — submit the peeked
        // cards highest projected value first, so the bot draws its best card
        // next (ADR 0018). Ties keep the exposed order (stable sort).
        case "reorder-library":
            return bestFirst(candidates).map((c) => c.id);

        // `may-pay` is a yes/no answer routed through `submitMayPay`
        // (`decideBotAction` handles it before reaching here), and
        // `mulligan-bottom` has its own pre-game branch. Reaching either via
        // `chooseResolution` is a programming error.
        case "may-pay":
        case "mulligan-bottom":
            throw new Error(
                `chooseResolution: "${kind}" is not resolved here (use the dedicated path)`
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

    // The active player gets priority on entering each combat sub-step (CR
    // 508–510), but the server forbids passing until that step's turn-based
    // action is done — a `passPriority` is rejected, and the driver retries on
    // the next state, looping forever. Mirror those gates so the bot resolves
    // the step (or waits) instead of passing into a rejection.

    // Combat-damage assignment (CR 510.1c, multi-block). The assigner must
    // confirm damage before priority can pass; `passPriority` is rejected while
    // `damageConfirmed === false`. Confirm instead of passing.
    if (
        (view.phase === "FIRST_STRIKE_DAMAGE" ||
            view.phase === "COMBAT_DAMAGE") &&
        view.hasCombat &&
        view.damageConfirmed === false
    ) {
        if (view.botOwesDamageConfirm) return { kind: "confirm-combat-damage" };
        // Bot holds priority but is not the (outstanding) assigner: wait for the
        // assigner to confirm rather than pass into a rejection.
        if (view.priorityPlayerId === view.botId) return NONE;
    }

    // Attacker awaiting the defender's blocks (CR 509.1). The active attacker
    // holds priority here, but a pass is rejected until blockers are confirmed;
    // the defender declares blocks via its own client, so the bot just waits.
    if (
        view.phase === "DECLARE_BLOCKERS" &&
        view.hasCombat &&
        !view.blockersConfirmed &&
        view.activePlayerId === view.botId
    ) {
        return NONE;
    }

    // Ordinary priority window.
    if (view.priorityPlayerId === view.botId) return { kind: "pass" };

    return NONE;
}
