import type {
    CardInstance,
    PendingTarget,
    Player,
    StackItem,
} from "~/types/game";
import { tryGetDefinition } from "@convex/cards";
import { tryGetEmblemDefinition } from "@convex/cards/emblems";
import { getEffectiveActivatedAbilities } from "@convex/gre/activatedAbilities";
import type { CardInstanceState } from "@convex/gre/state";
import { displayCardId, getStackAbilityOracleText } from "~/lib/card-utils";

/** The last-resort label when the source of a target selection cannot be
 *  found in any zone the viewer sees (issue #8426). */
export const UNRESOLVED_TARGET_SOURCE = "spell";

/** Where a `PendingTarget` comes from, resolved off the viewer's projected
 *  board (issue #8426). One resolver for the target banner and the graveyard
 *  target dialog: each used to roll its own fallback, and both read only the
 *  hand for a spell, so an ability or a cast from graveyard/exile was titled
 *  "spell".
 *
 *  - `ability` (CR 602.2b) — `cardInstanceId` is the source object: a
 *    permanent, or a card in another zone for an ability that functions there.
 *  - `trigger` (CR 603.3d) — `cardInstanceId` is the trigger's STACK ITEM.
 *  - a cast (CR 601.2c) — the card being cast. The engine asks for its
 *    targets before moving it, so it is still in hand, graveyard or exile
 *    here, although CR 601.2a moves it to the stack first. */
export type PendingTargetSource =
    | { kind: "ability"; card: CardInstance }
    | { kind: "trigger"; item: StackItem }
    | { kind: "cast"; card: CardInstance }
    | null;

function viewerZoneCards(me: Player | undefined): CardInstance[] {
    if (!me) return [];
    return [
        ...me.battlefield,
        ...me.hand.filter((c): c is CardInstance => c !== null),
        ...me.graveyard,
        ...me.exile,
    ];
}

export function resolvePendingTargetSource(
    pendingTarget: PendingTarget,
    me: Player | undefined,
    stack: readonly StackItem[]
): PendingTargetSource {
    const id = pendingTarget.cardInstanceId;
    if (pendingTarget.kind === "trigger") {
        const item = stack.find((s) => s.id === id);
        return item ? { kind: "trigger", item } : null;
    }
    const card = viewerZoneCards(me).find((c) => c.id === id);
    if (!card) return null;
    return pendingTarget.kind === "ability"
        ? { kind: "ability", card }
        : { kind: "cast", card };
}

/** The source's NAME: the card (its displayed face) or, for an emblem-sourced
 *  trigger, the emblem (CR 114.1 — an emblem key is absent from the card
 *  registry). `null` when nothing resolves. */
function sourceName(source: PendingTargetSource): string | null {
    if (!source) return null;
    const instance = source.kind === "trigger" ? source.item : source.card;
    return (
        tryGetDefinition(displayCardId(instance))?.name ??
        tryGetEmblemDefinition(instance.card.id)?.name ??
        null
    );
}

/** The banner's source line: the source's name. A copy-retarget (CR 707.10c)
 *  reads "Copy" — its target is a spell copy, not a card the viewer holds. */
export function pendingTargetSourceName(
    pendingTarget: PendingTarget,
    me: Player | undefined,
    stack: readonly StackItem[]
): string {
    const name = sourceName(
        resolvePendingTargetSource(pendingTarget, me, stack)
    );
    if (name) return name;
    return pendingTarget.kind === "copy-retarget"
        ? "Copy"
        : UNRESOLVED_TARGET_SOURCE;
}

/** CR 113.1a / 613.1f — the activated ability's own Oracle text, looked up
 *  in the source's POST-LAYER ability set: a transformed face's (CR 712.8e) and a
 *  granted one included. A grant names the card that prints it, which
 *  disambiguates two sources granting the same ability id. */
function activatedAbilityText(
    card: CardInstance,
    pendingTarget: PendingTarget
): string | null {
    const entries = getEffectiveActivatedAbilities(
        card as unknown as CardInstanceState
    ).filter(({ ability }) => ability.id === pendingTarget.abilityId);
    const entry =
        entries.find(
            (e) => e.grantedSourceCardId === pendingTarget.grantedSourceCardId
        ) ?? entries[0];
    return entry?.ability.oracleText || null;
}

/** The graveyard target dialog's title (issue #8426), by `kind`:
 *  an activated ability → its Oracle text; a trigger → its Oracle text, else
 *  its source's name; a cast → the card's name. "spell" only when the source
 *  resolves nowhere. */
export function pendingTargetTitle(
    pendingTarget: PendingTarget,
    me: Player | undefined,
    stack: readonly StackItem[]
): string {
    const source = resolvePendingTargetSource(pendingTarget, me, stack);
    if (source?.kind === "ability") {
        const text = activatedAbilityText(source.card, pendingTarget);
        if (text) return text;
    }
    if (source?.kind === "trigger") {
        const text = getStackAbilityOracleText(source.item);
        if (text) return text;
    }
    return pendingTargetSourceName(pendingTarget, me, stack);
}

/** Identity of a target selection for the minimize toggle (issue #8426): a
 *  new `PendingTarget` — another source, or the next requirement of the same
 *  one — opens expanded. `selected` is deliberately absent: picking the first
 *  of two targets is the SAME selection. */
export function pendingTargetKey(
    pendingTarget: PendingTarget | undefined
): string | null {
    if (!pendingTarget) return null;
    return [
        pendingTarget.playerId,
        pendingTarget.cardInstanceId,
        pendingTarget.kind ?? "cast",
        pendingTarget.abilityId ?? "",
        JSON.stringify(pendingTarget.targetType),
        pendingTarget.zone ?? "",
        pendingTarget.priorSelected?.length ?? 0,
        pendingTarget.remainingRequirements?.length ?? 0,
    ].join(":");
}
