/**
 * The viewer's open target choice as ONE shape (issue #9163), whichever flow
 * opened it: the attack target of a creature being declared (CR 508.1b) or a
 * spell / ability target (CR 601.2c / 602.2b / 603.3d, `pendingTarget`). The
 * targeting arrow draws from {@link TargetingSession.sources} to the cursor
 * and snaps to {@link TargetingSession.targets}.
 *
 * Pure: derived from projected state through the shared candidate predicates
 * (`target-candidates.ts`) — never read back from the DOM.
 */
import type { AnchorKind } from "~/hooks/arrowAnchorContext";
import type { AnchorMap, AnchorPoint } from "~/lib/target-arrow-geometry";
import type { Combat, PendingTarget, Player, StackItem } from "~/types/game";
import { isPlaneswalker } from "~/lib/card-utils";
import {
    getEligibleGraveyards,
    isGraveyardTargetForViewer,
} from "~/lib/graveyard-targets";
import {
    isLegalPermanentTarget,
    isLegalPlayerTarget,
    isLegalStackTarget,
    type PermanentCandidateEnv,
} from "~/lib/target-candidates";

/** One board node an arrow can start at or point to. `card` = a card that
 *  has no anchor bucket (a spell still in hand / graveyard / exile while its
 *  targets are chosen, CR 601.2c) — measured from its slot. */
export type TargetingNode = { kind: AnchorKind | "card"; id: string };

export type TargetingSession = {
    mode: "attack" | "target";
    sources: TargetingNode[];
    targets: TargetingNode[];
};

/** Stable `kind:id` key of a node. */
export function targetingNodeKey(node: TargetingNode): string {
    return `${node.kind}:${node.id}`;
}

/** Ids every node of the session names — the set the board keeps lit while
 *  the rest dims. */
export function targetingSessionNodeIds(
    session: TargetingSession
): ReadonlySet<string> {
    return new Set([...session.sources, ...session.targets].map((n) => n.id));
}

export type AttackTargetingInput = {
    phase: string;
    combat: Combat | undefined;
    viewerId: string;
    activePlayerId: string;
    allPlayers: readonly Player[];
    /** Creatures whose attack target is being chosen right now — the "Attack
     *  with all" cursor, else the clicked awaiting set. */
    choosingAttackerIds: readonly string[];
};

/** CR 508.1b — the attack-target session, or `null` when no creature of the
 *  viewer's is choosing where it attacks. Targets: each defending player and
 *  the planeswalkers they control (the same candidates the nameplate and the
 *  planeswalker ring offer). */
export function attackTargetingSession(
    input: AttackTargetingInput
): TargetingSession | null {
    const { combat, viewerId, activePlayerId } = input;
    if (
        input.phase !== "DECLARE_ATTACKERS" ||
        !combat ||
        combat.confirmed ||
        combat.pendingAttackManaTax ||
        viewerId !== activePlayerId ||
        input.choosingAttackerIds.length === 0
    ) {
        return null;
    }
    const defenders = input.allPlayers.filter((p) => p.id !== activePlayerId);
    return {
        mode: "attack",
        sources: input.choosingAttackerIds.map((id) => ({
            kind: "permanent",
            id,
        })),
        targets: [
            ...defenders.map((p) => ({ kind: "player" as const, id: p.id })),
            ...defenders.flatMap((p) =>
                p.battlefield
                    .filter(isPlaneswalker)
                    .map((c) => ({ kind: "permanent" as const, id: c.id }))
            ),
        ],
    };
}

function onBattlefield(players: readonly Player[], id: string): boolean {
    return players.some((p) => p.battlefield.some((c) => c.id === id));
}

/** Where a pending target's arrow starts: the permanent whose ability it is
 *  activating it, a trigger's source permanent when it is still on the
 *  battlefield (else its stack object, CR 603.3d), the stack object being
 *  retargeted (CR 115.7 / 707.10c), or the card being cast (CR 601.2c). */
function pendingTargetSource(
    pendingTarget: PendingTarget,
    allPlayers: readonly Player[],
    stackItems: readonly StackItem[]
): TargetingNode {
    const id = pendingTarget.cardInstanceId;
    switch (pendingTarget.kind) {
        case "ability":
            return { kind: "permanent", id };
        case "trigger": {
            const item = stackItems.find((s) => s.id === id);
            const sourceId = item?.triggerSourceId;
            if (sourceId && onBattlefield(allPlayers, sourceId)) {
                return { kind: "permanent", id: sourceId };
            }
            return { kind: "stack", id };
        }
        case "retarget":
        case "copy-retarget":
            if (stackItems.some((s) => s.id === id)) {
                return { kind: "stack", id };
            }
            return onBattlefield(allPlayers, id)
                ? { kind: "permanent", id }
                : { kind: "card", id };
        case "cast":
        case undefined:
            return { kind: "card", id };
        default: {
            const _exhaustive: never = pendingTarget.kind;
            return _exhaustive;
        }
    }
}

/** CR 601.2c — the spell / ability target session, or `null` when the viewer
 *  is not choosing a target. A divide-as-you-choose selection (CR 601.2d) is
 *  not click-to-target — its steppers assign — so it opens none. Targets span
 *  every zone the board can click: permanents, players, stack objects and
 *  the graveyards holding a legal card. */
export function pendingTargetingSession(
    pendingTarget: PendingTarget | undefined | null,
    env: PermanentCandidateEnv
): TargetingSession | null {
    if (!pendingTarget || pendingTarget.playerId !== env.viewerId) return null;
    if (pendingTarget.divideTotal !== undefined) return null;
    const targets: TargetingNode[] = [];
    // CR 400.1 — a graveyard-zone requirement names cards in graveyards, not
    // permanents that happen to share the type.
    const onBoard = !pendingTarget.zone || pendingTarget.zone === "battlefield";
    for (const p of onBoard ? env.allPlayers : []) {
        for (const card of p.battlefield) {
            if (isLegalPermanentTarget(card, pendingTarget, env)) {
                targets.push({ kind: "permanent", id: card.id });
            }
        }
    }
    for (const p of env.allPlayers) {
        if (isLegalPlayerTarget(p, pendingTarget, env)) {
            targets.push({ kind: "player", id: p.id });
        }
    }
    for (const item of env.stackItems) {
        if (isLegalStackTarget(item, pendingTarget, env)) {
            targets.push({ kind: "stack", id: item.id });
        }
    }
    if (isGraveyardTargetForViewer(pendingTarget, env.viewerId)) {
        for (const pile of getEligibleGraveyards(
            pendingTarget,
            env.allPlayers,
            env.viewerId,
            env.activePlayerId
        )) {
            targets.push({ kind: "graveyard", id: pile.playerId });
        }
    }
    return {
        mode: "target",
        sources: [
            pendingTargetSource(pendingTarget, env.allPlayers, env.stackItems),
        ],
        targets,
    };
}

/** The `data-arrow-anchor-*` attribute each anchor kind publishes. */
const ANCHOR_ATTRS: ReadonlyArray<[AnchorKind, string]> = [
    ["permanent", "data-arrow-anchor-permanent"],
    ["player", "data-arrow-anchor-player"],
    ["stack", "data-arrow-anchor-stack"],
    ["graveyard", "data-arrow-anchor-graveyard"],
];
const ANCHOR_SELECTOR = ANCHOR_ATTRS.map(([, a]) => `[${a}]`).join(",");

/** `kind:id` of the anchored board node `target` sits in (the card, nameplate,
 *  stack row or graveyard pile under the cursor), or `null`. Reads only WHICH
 *  node is hovered — legality stays with the session's state-derived set. */
export function anchorNodeKeyOf(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const el = target.closest(ANCHOR_SELECTOR);
    if (!el) return null;
    for (const [kind, attr] of ANCHOR_ATTRS) {
        const id = el.getAttribute(attr);
        if (id) return targetingNodeKey({ kind, id });
    }
    return null;
}

/** Board point of a session node: its anchor bucket, or the measured slot of
 *  a `card` source. `null` while unpublished. */
export function targetingNodePoint(
    node: TargetingNode,
    anchors: AnchorMap,
    cardPoints: Readonly<Record<string, AnchorPoint>>
): AnchorPoint | null {
    if (node.kind === "card") return cardPoints[node.id] ?? null;
    return anchors[node.kind][node.id] ?? null;
}
