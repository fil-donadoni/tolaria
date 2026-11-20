// Where a mid-resolution card name is SOUGHT, read off the resolving object's
// own Effect Script (issue #9551).
//
// CR 201.4 — an effect that has a player choose a card name then looks for
// cards with that name somewhere; WHERE decides which names are worth naming.
// A `name-card` PendingChoice says so explicitly only for a name sought in the
// chooser's own library (`nameSoughtIn`, raised by an imperative `resolve()`).
// A DSL script needs no declaration: the `nameCard` Op binds the chosen name
// (its `bind` IS the choice's `choiceId`), and a later Op reads that binding
// back through its card filter's bare `{ ref }`. When that Op is a `discard`
// (CR 701.9 — a discard is always from a hand), the name is sought in the
// hand of the player the discard names — "Target player reveals their hand
// and discards all cards with that name" (CR 701.20a, the reveal).
//
// Reads only public information — the object on the stack, its announced
// targets — so the client-side `searchable` gate (`src/lib/ai/bot-view.ts`)
// and the search agree on the projected and the full state alike.

import type { EffectOp } from "../../cards/types";
import type { StackItem } from "../state";
import type { PendingChoice } from "../state";
import { effectScriptOfStackItem } from "../stackItemScript";
import { childOpArrays } from "./effectOpChildren";

/** The slice of a stack object this read needs — a `StackItem` or its
 *  projected `SlimStackItem` alike. */
export type NameSeekingStackItem = Pick<
    StackItem,
    "id" | "controllerId" | "abilityId" | "triggeredAbilityId" | "targets"
> & { card: { id?: string } | Record<string, unknown> };

/** The board this read needs — a `GameState` or the projected public one. */
export type NameSeekingBoard = {
    stack?: ReadonlyArray<NameSeekingStackItem>;
    players: ReadonlyArray<{ id: string }>;
};

/** Ops whose card filter is applied to a HAND (CR 701.9: a discard is from
 *  its player's hand). */
const HAND_FILTER_OPS: ReadonlySet<EffectOp["op"]> = new Set(["discard"]);

/** The player ref of the first hand-filtering Op that reads `bind` as a name,
 *  anywhere in the script's nested tree. */
function handSeekerOf(
    script: readonly EffectOp[],
    bind: string
): unknown | undefined {
    for (let i = 0; i < script.length; i++) {
        const op = script[i];
        const record = op as unknown as {
            player?: unknown;
            filter?: { name?: unknown };
        };
        const name = record.filter?.name as { ref?: unknown } | undefined;
        if (
            HAND_FILTER_OPS.has(op.op) &&
            typeof name === "object" &&
            name !== null &&
            name.ref === bind
        )
            return record.player;
        const childList = childOpArrays(op);
        for (let j = 0; j < childList.length; j++) {
            const child = childList[j];
            const found = handSeekerOf(child, bind);
            if (found !== undefined) return found;
        }
    }
    return undefined;
}

/** The resolving object's player ref, resolved against its announced targets
 *  (CR 115.1) and its controller. The two-player `"opponent"` only: with more
 *  seats the ref names no single hand. */
function resolveSeekerPlayer(
    ref: unknown,
    item: NameSeekingStackItem,
    board: NameSeekingBoard
): string | undefined {
    if (ref === "controller") return item.controllerId;
    if (ref === "opponent") {
        const others = board.players.filter((p) => p.id !== item.controllerId);
        return others.length === 1 ? others[0].id : undefined;
    }
    if (typeof ref === "object" && ref !== null && "target" in ref) {
        const slot = (ref as { target: unknown }).target;
        if (typeof slot !== "number") return undefined;
        const target = item.targets?.[slot];
        return target?.type === "player" ? target.id : undefined;
    }
    return undefined;
}

/** The player whose HAND a mid-resolution `name-card` choice's name is sought
 *  in, or `undefined` when the resolving script seeks it elsewhere (or nowhere
 *  this read can see: an imperative body, an as-enters name). */
export function nameSoughtInHandOf(
    choice: PendingChoice,
    board: NameSeekingBoard | undefined
): string | undefined {
    if (choice.kind !== "name-card" || choice.nameSoughtIn !== undefined)
        return undefined;
    const item = board?.stack?.find((s) => s.id === choice.stackItemId);
    if (!item || !board) return undefined;
    const script = effectScriptOfStackItem(item);
    if (!script) return undefined;
    const ref = handSeekerOf(script, choice.choiceId);
    return ref === undefined
        ? undefined
        : resolveSeekerPlayer(ref, item, board);
}
