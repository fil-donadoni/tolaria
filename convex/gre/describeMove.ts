// Human-readable label for a Bot Move (DecisionTrace debug view).
//
// The DecisionTrace lists the candidate moves the Brain weighed at a decision;
// a raw `Move` (cardInstanceId + TargetSelection[]) is unreadable, so this turns
// it into "cast Braingeyser → You (X=4)" by resolving instance ids to card names
// and target ids to player / permanent labels. PURE: a read-only projection of
// `state`, no mutation. Used only off the authoritative path.

import type { GameState, CardInstanceState } from "./state";
import type { Move } from "./moves";
import type { TargetSelection } from "../cards/types";
import { tryGetDefinition } from "../cards";

type Named = { id: string; card: Record<string, unknown> };

/** Best-effort card name for an instance/stack item, mirroring rules.ts: prefer
 *  an inlined `name` (legacy fixtures), else the registry, else the instance id. */
function cardName(obj: Named): string {
    const inlined = (obj.card as { name?: string }).name;
    if (inlined) return inlined;
    const id = (obj.card as { id?: string }).id;
    return (id ? tryGetDefinition(id)?.name : undefined) ?? obj.id;
}

function findInstanceAnyZone(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        for (const zone of [
            p.battlefield,
            p.hand,
            p.graveyard,
            p.exile,
            p.library,
        ]) {
            const c = zone.find((x) => x.id === id);
            if (c) return c;
        }
    }
    return undefined;
}

function instanceName(state: GameState, id: string): string {
    const c = findInstanceAnyZone(state, id);
    return c ? cardName(c) : id;
}

function playerLabel(state: GameState, id: string): string {
    return state.players.find((p) => p.id === id)?.name ?? id;
}

function targetLabel(state: GameState, t: TargetSelection): string {
    switch (t.type) {
        case "player":
            return playerLabel(state, t.id);
        case "permanent":
        case "graveyard-card":
        case "hand-card":
            return instanceName(state, t.id);
        case "spell": {
            const item = state.stack.find((s) => s.id === t.id);
            return item ? cardName(item) : `spell ${t.id}`;
        }
    }
}

function withTargets(state: GameState, targets: TargetSelection[]): string {
    if (targets.length === 0) return "";
    return ` → ${targets.map((t) => targetLabel(state, t)).join(", ")}`;
}

/** A short, human-readable description of `move` in the context of `state`. */
export function describeMove(move: Move, state: GameState): string {
    switch (move.kind) {
        case "pass":
            return "pass";
        case "mulligan":
            return move.decision === "keep" ? "keep hand" : "mulligan";
        case "mulligan-bottom":
            return `bottom ${move.cardInstanceIds.length} card${
                move.cardInstanceIds.length === 1 ? "" : "s"
            }`;
        case "resolution-choice":
            return `resolve choice (${move.cardInstanceIds.length} card${
                move.cardInstanceIds.length === 1 ? "" : "s"
            })`;
        case "may-pay":
            return move.accept ? "pay optional cost" : "decline optional cost";
        case "land-entry":
            return move.accept
                ? "pay to enter untapped"
                : "enter tapped (decline)";
        case "draw-replacement":
            return move.accept
                ? "pay life to bin revealed card"
                : "let them draw (decline)";
        case "name-card":
            return `name a card (${move.cardName})`;
        case "random-reveal-ack":
            return "acknowledge coin flip";
        case "madness-decline":
            return "decline madness cast (to graveyard)";
        case "rebound-decline":
            return "decline rebound cast (remains exiled)";
        case "submit-target":
            // CR 603.3d / 115.7 / 707.10b (issue #2283) — the standalone answer
            // to an engine-raised target selection.
            return move.targets.length === 0
                ? "choose no targets"
                : `target ${move.targets
                      .map((t) => targetLabel(state, t))
                      .join(", ")}`;
        case "play-land":
            return `play ${instanceName(state, move.cardInstanceId)}`;
        case "summon-companion":
            return "summon companion";
        // CR 116.2b / 702.37e — the turn-face-up special action. Names the
        // permanent by its FACE-DOWN identity ("face-down creature"), which is
        // what `instanceName` reads off the sentinel def: a trace line that
        // printed the real card would leak the very identity the mechanic
        // hides, and traces are read while a game is live.
        case "turn-face-up":
            return `turn face up ${instanceName(state, move.cardInstanceId)}`;
        case "cast-spell": {
            const name = instanceName(state, move.cardInstanceId);
            const x = move.chosenX !== undefined ? ` (X=${move.chosenX})` : "";
            // CR 118.9 / 702.103a — an alternative-cost cast is a DIFFERENT
            // move from the plain one and must read as such in a trace: "cast
            // Springheart Nantuko" and "cast Springheart Nantuko [bestow]
            // target Grizzly Bears" are two lines a reader has to tell apart.
            const alt = move.alternativeCostId
                ? ` [${move.alternativeCostId}]`
                : "";
            return `cast ${name}${x}${alt}${withTargets(state, move.targets)}`;
        }
        case "activate-ability": {
            const name = instanceName(state, move.cardInstanceId);
            const x = move.chosenX !== undefined ? ` (X=${move.chosenX})` : "";
            const mode = move.chosenModeId ? ` [${move.chosenModeId}]` : "";
            return `activate ${name}${x}${mode}${withTargets(state, move.targets)}`;
        }
        case "declare-attackers":
            return move.attackerIds.length === 0
                ? "no attacks"
                : `attack: ${move.attackerIds
                      .map((id) => instanceName(state, id))
                      .join(", ")}`;
        case "declare-blockers":
            return move.assignments.length === 0
                ? "no blocks"
                : `block: ${move.assignments
                      .map(
                          (a) =>
                              `${instanceName(state, a.blockerId)} ↦ ${instanceName(
                                  state,
                                  a.attackerId
                              )}`
                      )
                      .join(", ")}`;
    }
}
