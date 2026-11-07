// CR 115.7d / 707.10c — the rows of a raised "choose new targets" prompt that
// leave a current target unchanged. The engine published what may stay
// (`PendingTarget.keepableTargetGroups`); this only names it for the banner, so
// a target that can't be clicked (illegal by now, or gone from its zone) can
// still be kept beside a changed one.

import type { PendingTarget, Player, StackItem } from "~/types/game";
import { tryGetDefinition } from "@convex/cards";
import { displayCardId } from "~/lib/card-utils";

export type KeepTargetRow = {
    key: string;
    label: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
    targetPlayerId?: string;
};

function targetName(
    target: { type: string; id: string; playerId?: string },
    players: readonly Player[],
    stack: readonly StackItem[]
): string | undefined {
    if (target.type === "player") {
        return players.find((p) => p.id === target.id)?.name;
    }
    const card =
        target.type === "spell"
            ? stack.find((s) => s.id === target.id)
            : players
                  .flatMap((p) =>
                      target.type === "graveyard-card"
                          ? p.graveyard
                          : p.battlefield
                  )
                  .find((c) => c.id === target.id);
    return card ? tryGetDefinition(displayCardId(card))?.name : undefined;
}

/** One row per current target of the group being answered not picked yet. A
 *  target gone from its zone has no name left to read on the wire. */
export function keepTargetRows(
    pendingTarget: Pick<PendingTarget, "keepableTargetGroups" | "selected">,
    players: readonly Player[],
    stack: readonly StackItem[]
): KeepTargetRow[] {
    const group = pendingTarget.keepableTargetGroups?.[0] ?? [];
    const picked = (t: { type: string; id: string }) =>
        pendingTarget.selected.some((s) => s.type === t.type && s.id === t.id);
    return group
        .filter((t) => !picked(t))
        .map((t) => ({
            key: `${t.type}:${t.id}`,
            label: `Keep ${targetName(t, players, stack) ?? "departed target"}`,
            targetType: t.type,
            targetId: t.id,
            ...(t.playerId ? { targetPlayerId: t.playerId } : {}),
        }));
}
