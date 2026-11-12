import { tryGetDefinition } from "@convex/cards";
import { tryGetEmblemDefinition } from "@convex/cards/emblems";
import type { TargetSelection } from "@convex/cards/types";
import type { CardInstance, Player, StackItem } from "~/types/game";
import { displayCardId } from "~/lib/card-utils";

/** One line of a stack row's Targets block (issue #9326): WHAT the target is
 *  and WHERE — which card in which pile, which row of the stack. */
export type StackTargetLine = {
    /** The announced target (CR 601.2c) this line lists. */
    target: TargetSelection;
    /** The object shown as the line's thumbnail; `null` for a player. */
    card: CardInstance | null;
    /** Display name. */
    title: string;
    /** Muted second line: "#4 in Opponent's graveyard", "#5 on the stack
     *  (spell)", "on your battlefield", "player". */
    where: string;
};

/** Resolve a stack item's announced targets (CR 601.2c) to the lines of its
 *  Targets block (issue #9326, superseding the phone-only name line of issue
 *  #2727): every target, whatever its kind, names itself AND where it is.
 *
 *  The board arrow says where a target is, but for a card in a graveyard it
 *  lands on the PILE — several Llanowar Elves in one graveyard, and nothing
 *  said which one. The line closes that: the card's position in its zone
 *  ({@link zonePosition}, the numbers the zone viewer shows while targeted),
 *  or the stack row number ({@link stackNumber}) for a spell or ability.
 *
 *  Pure and React-free. An id that resolves to nothing yields no line rather
 *  than a raw instance id — a hex string is worse than a shorter list. */
export function stackTargetLines(
    item: StackItem,
    allPlayers: readonly Player[],
    stack: readonly StackItem[],
    viewerId: string
): StackTargetLine[] {
    const lines: StackTargetLine[] = [];
    for (const target of item.targets ?? []) {
        const line = resolveTargetLine(target, allPlayers, stack, viewerId);
        if (line) lines.push(line);
    }
    return lines;
}

/** The stack panel's row number for `id` — 1 = top of the stack, the next to
 *  resolve; the same number the row's badge shows. 0 when absent. */
export function stackNumber(stack: readonly StackItem[], id: string): number {
    const i = stack.findIndex((s) => s.id === id);
    return i < 0 ? 0 : stack.length - i;
}

/** A card's 1-based position in its zone, in the zone viewer's left-to-right
 *  order (array order). 0 when absent. */
export function zonePosition(
    zoneCards: readonly CardInstance[],
    id: string
): number {
    return zoneCards.findIndex((c) => c.id === id) + 1;
}

/** "your" for the viewer's own zone, "<name>'s" for anyone else's. */
function whose(player: Player, viewerId: string): string {
    return player.id === viewerId ? "your" : `${player.name}'s`;
}

/** Whether a stack object is an ability (activated, triggered or delayed) —
 *  the same discriminant `resolveArrowSource` reads. */
function isAbilityItem(item: StackItem): boolean {
    return !!item.abilityId || !!item.triggeredAbilityId;
}

function resolveTargetLine(
    target: TargetSelection,
    allPlayers: readonly Player[],
    stack: readonly StackItem[],
    viewerId: string
): StackTargetLine | null {
    switch (target.type) {
        case "player": {
            const player = allPlayers.find((p) => p.id === target.id);
            if (!player) return null;
            return {
                target,
                card: null,
                title: player.name,
                where: player.id === viewerId ? "player · you" : "player",
            };
        }
        case "spell": {
            const spell = stack.find((s) => s.id === target.id);
            // Issue #1735 (round 3) — a face-down spell's `card.id` is the CR
            // 708.2 sentinel for EVERY viewer including the caster; the line
            // is display-only, so it reads `displayCardId`, exactly like
            // `stack-row.tsx`'s own `identityId`.
            const title = spell ? cardName(displayCardId(spell)) : null;
            if (!spell || !title) return null;
            const kind = isAbilityItem(spell) ? "ability" : "spell";
            return {
                target,
                card: spell,
                title,
                where: `#${stackNumber(stack, spell.id)} on the stack (${kind})`,
            };
        }
        case "graveyard-card": {
            // Zone-scoped (CR 400.7 / 109.2): `playerId` names WHICH
            // graveyard; a projection that ever omits it still resolves, so
            // the search widens to every seat rather than returning nothing.
            for (const seat of seatsFor(target, allPlayers)) {
                const hit = seat.graveyard.find((c) => c.id === target.id);
                const title = hit ? cardName(displayCardId(hit)) : null;
                if (!hit || !title) continue;
                return {
                    target,
                    card: hit,
                    title,
                    where: `#${zonePosition(seat.graveyard, hit.id)} in ${whose(
                        seat,
                        viewerId
                    )} graveyard`,
                };
            }
            return null;
        }
        case "permanent": {
            for (const seat of allPlayers) {
                const hit = seat.battlefield.find((c) => c.id === target.id);
                // Only a battlefield hit can be face down (CR 708.7);
                // `displayCardId` resolves its display identity per viewer.
                const title = hit ? cardName(displayCardId(hit)) : null;
                if (!hit || !title) continue;
                return {
                    target,
                    card: hit,
                    title,
                    where: `on ${whose(seat, viewerId)} battlefield`,
                };
            }
            return null;
        }
        case "hand-card":
            // issue #1101 — never a real ANNOUNCED target (CR 601.2c): only
            // `lookDistribute`'s internal `bind` produces it, so no stack
            // item's `targets[]` carries one. Nothing to list.
            return null;
        default: {
            const _exhaustive: never = target.type;
            return _exhaustive;
        }
    }
}

function seatsFor(
    target: TargetSelection,
    allPlayers: readonly Player[]
): readonly Player[] {
    return target.playerId != null
        ? allPlayers.filter((p) => p.id === target.playerId)
        : allPlayers;
}

/** CR 114 — an emblem-sourced object's `card.id` is an emblem KEY, absent from
 *  the card registry, so the emblem registry is the second lookup rather than
 *  a raw id fallback. */
function cardName(cardId: string): string | null {
    return (
        tryGetDefinition(cardId)?.name ??
        tryGetEmblemDefinition(cardId)?.name ??
        null
    );
}
