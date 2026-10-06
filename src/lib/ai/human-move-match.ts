// Which `Move` did the HUMAN make? (issue #3984)
//
// A Verdict Proposal is a decision the player made and the Brain is asked
// about, so it needs the player's move in the Brain's vocabulary — a `Move` the
// search could itself have chosen. The player never produces one: their clicks
// reach the server as granular mutations (`announceCast`, `selectTarget`,
// `toggleAttacker`, …).
//
// The bridge already exists in the other direction. `executeMove`
// (`executor.ts`) realises a `Move` as "the SAME mutation sequence a human's
// clicks would" make; so the player's move is the candidate whose realisation
// IS what they submitted. Every legal candidate of the decision is realised
// into a recorder rather than the server, both sides are folded into one
// canonical shape, and an exact match names the move. The executor stays the
// one authority on what a move looks like as mutations — nothing here restates
// a move kind's call sequence.
//
// WHAT THE FOLD FORGETS, and why each is safe to forget:
//   - PAYMENT. Which land paid is the player's tapping, not the decision: the
//     executor's `tapPlan` and a player's clicks routinely differ on it, and no
//     verdict is about it. Every tap / untap / auto-pay / mana-spend call goes.
//   - `confirmTargets`. The executor confirms only where the requirement needs
//     it; the UI may confirm by its own rule. The targets themselves are kept.
//   - BATCHING. `selectTarget` × n and `selectTargets` once are one ordered
//     target list; `toggleAttacker` clicks and one `declareAttackers` are one
//     attacking set; `selectBlocker`/`assignBlockerTarget` pairs and one
//     `declareBlockers` are one block assignment.
//   - EMPTY OPTIONALS. `chosenModeIds: []`, `buyback: false` and an absent
//     field say the same.
//   - `keepPriority`, the UI's hold-priority flag: it shapes the NEXT
//     decision, never this one.
//
// Anything else the player sent — a cancel, an `endTurn` shortcut, a call no
// candidate realises — leaves the window unmatched, and an unmatched decision
// is DROPPED, never guessed: a proposal about a move the player did not make is
// a question about nothing.

import { enumerateMoves, type Move } from "@convex/gre";
import { moveKey } from "@convex/gre/search";
import type { GameState } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import { executeMove, type MoveMutations } from "./executor";
import type { TappedMutation } from "./mutation-tap";

/** The module prefix every game mutation's function name carries. */
const GAME_MODULE = "game:";

/** Mutations that PAY for a decision rather than make it. */
const PAYMENT_CALLS: ReadonlySet<string> = new Set([
    "tapForPayment",
    "tapUntap",
    "untapForPayment",
    "autoTapForPayment",
    "activateManaAbility",
    "tapForActivationPayment",
    "autoTapForAttackTax",
    "tapForAttackTax",
    "untapForAttackTax",
    "resolveManaSpendChoice",
    "selectConvokeCreatures",
    "confirmTargets",
]);

/** Args that are never part of the decision: the seat identity every call
 *  carries, and `keepPriority` — the UI's "hold priority after this" flag
 *  (CR 117.3c), which the executor never sends and which changes what the
 *  player does NEXT, not what this move is. */
const FORGOTTEN_ARGS: ReadonlySet<string> = new Set([
    "gameId",
    "playerId",
    "keepPriority",
]);

/** Calls that are about the client's own automation, not the game. */
const CLIENT_CALLS: ReadonlySet<string> = new Set(["cancelAutoPass"]);

/** One step of a folded decision. */
type FoldedStep = { step: string; detail: unknown };

function isEmpty(value: unknown): boolean {
    // `false` is an unset flag (`buyback`, `payFlashSurcharge`): the UI sends
    // it explicitly where the executor leaves the field out.
    if (value === undefined || value === null || value === false) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
}

/** Key-sorted, empty-stripped copy — so field order and absent-vs-empty never
 *  decide a match. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            const v = (value as Record<string, unknown>)[key];
            if (isEmpty(v)) continue;
            out[key] = canonical(v);
        }
        return out;
    }
    return value;
}

function strip(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
        if (!FORGOTTEN_ARGS.has(k)) out[k] = v;
    }
    return out;
}

type Target = Record<string, unknown>;

/**
 * Fold a window of submitted calls (bare mutation names, e.g. `passPriority`)
 * into the canonical step list two windows are compared by.
 *
 * `playerIds` are the game's seats: an attack aimed at a PLAYER is the default
 * attack whether or not the call spelled the defender out, so it folds to no
 * target at all.
 */
export function foldDecisionCalls(
    calls: readonly TappedMutation[],
    playerIds: ReadonlySet<string>
): string {
    const steps: FoldedStep[] = [];
    let targets: Target[] | null = null;
    let attack: { targets: Map<string, string | null>; exert: Set<string> } = {
        targets: new Map(),
        exert: new Set(),
    };
    let blocks = new Map<string, string>();
    let blocker: string | null = null;

    const flushTargets = () => {
        if (targets === null) return;
        steps.push({ step: "targets", detail: canonical(targets) });
        targets = null;
    };
    const attackTarget = (to: unknown): string | null =>
        typeof to === "string" && !playerIds.has(to) ? to : null;

    for (const { name, args } of calls) {
        const call = name.startsWith(GAME_MODULE)
            ? name.slice(GAME_MODULE.length)
            : name;
        if (PAYMENT_CALLS.has(call) || CLIENT_CALLS.has(call)) continue;
        const a = strip(args);
        if (call === "selectTarget") {
            (targets ??= []).push(a);
            continue;
        }
        if (call === "selectTargets") {
            (targets ??= []).push(...((a.targets as Target[]) ?? []));
            continue;
        }
        flushTargets();
        switch (call) {
            case "toggleAttacker": {
                // The server's own rule: a declared attacker named again WITH
                // a planeswalker is retargeted, without one it is withdrawn.
                const id = a.cardInstanceId as string;
                const to = attackTarget(a.planeswalkerId);
                if (!attack.targets.has(id) || a.planeswalkerId !== undefined) {
                    attack.targets.set(id, to);
                } else {
                    attack.targets.delete(id);
                }
                continue;
            }
            case "toggleExert": {
                const id = a.cardInstanceId as string;
                if (attack.exert.has(id)) attack.exert.delete(id);
                else attack.exert.add(id);
                continue;
            }
            case "declareAttackers": {
                const to = (a.attackTargets ?? {}) as Record<string, string>;
                for (const id of (a.attackerIds as string[]) ?? []) {
                    attack.targets.set(id, attackTarget(to[id]));
                }
                for (const id of (a.exertIds as string[]) ?? []) {
                    attack.exert.add(id);
                }
                continue;
            }
            case "confirmAttackers": {
                steps.push({
                    step: "attack",
                    detail: canonical({
                        attackers: [...attack.targets.entries()]
                            .sort(([x], [y]) => x.localeCompare(y))
                            .map(([id, to]) => (to ? [id, to] : [id])),
                        exert: [...attack.exert].sort(),
                    }),
                });
                attack = { targets: new Map(), exert: new Set() };
                continue;
            }
            case "selectBlocker":
                blocker = a.cardInstanceId as string;
                continue;
            case "assignBlockerTarget":
                if (blocker !== null)
                    blocks.set(blocker, a.attackerId as string);
                blocker = null;
                continue;
            case "declareBlockers": {
                const list = (a.assignments ?? []) as {
                    blockerId: string;
                    attackerId: string;
                }[];
                for (const { blockerId, attackerId } of list) {
                    blocks.set(blockerId, attackerId);
                }
                continue;
            }
            case "confirmBlockers": {
                steps.push({
                    step: "block",
                    detail: [...blocks.entries()].sort(([x], [y]) =>
                        x.localeCompare(y)
                    ),
                });
                blocks = new Map();
                continue;
            }
            default:
                steps.push({ step: call, detail: canonical(a) });
        }
    }
    flushTargets();
    return JSON.stringify(steps);
}

/** The calls `executeMove` makes for `move`, recorded instead of sent. */
export async function realiseMoveCalls(
    move: Move,
    seatId: string
): Promise<TappedMutation[]> {
    const calls: TappedMutation[] = [];
    const mutations = new Proxy({} as MoveMutations, {
        get:
            (_target, key) =>
            (args: Record<string, unknown>): Promise<unknown> => {
                calls.push({ name: `${GAME_MODULE}${String(key)}`, args });
                return Promise.resolve(undefined);
            },
    });
    await executeMove(move, {
        // Never sent anywhere: the recorder above is the only "server".
        gameId: "" as Id<"games">,
        botId: seatId,
        mutations,
    });
    return calls;
}

/**
 * The legal move of `seatId` at `position` whose realisation is what the
 * player submitted, or `null` when none is.
 *
 * The RAW enumeration, not the verdict candidates' pruned and collapsed one:
 * collapsing interchangeable copies keeps one representative, and the player
 * may well have clicked the other copy.
 */
export async function identifyHumanMove(
    position: GameState,
    seatId: string,
    calls: readonly TappedMutation[]
): Promise<Move | null> {
    const playerIds = new Set(position.players.map((p) => p.id));
    if (calls.length === 0) return null;
    const submitted = foldDecisionCalls(calls, playerIds);
    const seen = new Set<string>();
    for (const move of enumerateMoves(position, seatId)) {
        const key = moveKey(move);
        if (seen.has(key)) continue;
        seen.add(key);
        let realised: TappedMutation[];
        try {
            realised = await realiseMoveCalls(move, seatId);
        } catch {
            continue;
        }
        if (foldDecisionCalls(realised, playerIds) === submitted) return move;
    }
    return null;
}
