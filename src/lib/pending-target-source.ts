import type {
    CardInstance,
    PendingTarget,
    Player,
    StackItem,
} from "~/types/game";
import { tryGetDefinition } from "@convex/cards";
import { tryGetEmblemDefinition } from "@convex/cards/emblems";
import { displayCardId } from "~/lib/card-utils";

/** The source of a Pending Target, resolved from the chooser's own zones and
 *  the stack. The ONE lookup behind both the target-selection banner and the
 *  graveyard target dialog title (issue #6984) — the two used to carry
 *  divergent copies, and the dialog's hand-only copy read "spell" for every
 *  `ability`, `trigger` and `copy-retarget`. */
export type PendingTargetSource = {
    /** What the prompt shows: the source's name, "Copy" for a copy-retarget
     *  (CR 707.10), else the generic "spell" fallback. */
    name: string;
    /** The card being cast (CR 601.2) — in hand, or still in the graveyard /
     *  exile for a Flashback or a Cast permission. Never set for an ability or
     *  a trigger. */
    castSource: CardInstance | undefined;
    /** For an activated ability (CR 602.1): the permanent it is on, found on
     *  the chooser's battlefield (`cardInstanceId` is the permanent's id). */
    sourcePermanent: CardInstance | undefined;
};

export function resolvePendingTargetSource(
    pendingTarget: PendingTarget,
    me: Player | undefined,
    stack: StackItem[]
): PendingTargetSource {
    const { kind, cardInstanceId } = pendingTarget;

    // A spell cast from a graveyard or exile permission is still in that zone
    // while its targets are chosen.
    const castSource =
        kind === "ability" || kind === "trigger"
            ? undefined
            : (me?.hand.find((c) => c !== null && c.id === cardInstanceId) ??
              [...(me?.graveyard ?? []), ...(me?.exile ?? [])].find(
                  (c) => c.id === cardInstanceId
              ));

    const sourcePermanent =
        kind === "ability"
            ? me?.battlefield.find((c) => c.id === cardInstanceId)
            : undefined;

    // A triggered ability chooses its target as it goes on the stack (CR
    // 603.3d): `cardInstanceId` is the trigger's STACK-ITEM id. Card registry
    // first, then the emblem registry (an emblem-sourced trigger's `card.id` is
    // an emblem KEY absent from the card registry).
    const triggerSource =
        kind === "trigger"
            ? stack.find((s) => s.id === cardInstanceId)
            : undefined;

    const name =
        (castSource && tryGetDefinition(castSource.card.id)?.name) ||
        (sourcePermanent &&
            tryGetDefinition(displayCardId(sourcePermanent))?.name) ||
        (triggerSource &&
            (tryGetDefinition(displayCardId(triggerSource))?.name ??
                tryGetEmblemDefinition(triggerSource.card.id)?.name)) ||
        (kind === "copy-retarget" ? "Copy" : "spell");

    return { name, castSource, sourcePermanent };
}
