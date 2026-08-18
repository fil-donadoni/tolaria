/**
 * Pure geometry for the spatial board's SVG target arrows (PRD #249, slice
 * #257). Maps a set of board-coordinate anchor points + the current stack to
 * the endpoints (and curved SVG path) of each target arrow.
 *
 * DOM-free and side-effect-free: every function here is a pure mapping from
 * `(stack, anchors)` → arrow specs, unit-testable without a renderer. The anchor
 * points are derived from the SAME shared layout placements that position the
 * cards (`board-layout.ts`, surfaced by the arrow-anchor registry, #251/#257),
 * so the arrows recompute from the single source of truth and never reverse-
 * engineer positions by sampling the moving DOM at an instant.
 */

import type { Combat, StackItem } from "~/types/game";

/** A resolved anchor point in board-root coordinates (px). Both endpoints of
 *  every arrow come from this — published by zones from layout placements and by
 *  the player/pile edge anchors. */
export type AnchorPoint = {
    x: number;
    y: number;
};

/** Lookup of every anchor id → its board-coordinate point. Mirrors the
 *  `data-arrow-anchor-*` key space: stack ids, permanent ids, player ids,
 *  graveyard-owner ids. */
export type AnchorMap = {
    /** Stack-item ids (source of every arrow; also `spell` targets). */
    stack: Record<string, AnchorPoint>;
    /** Permanent (battlefield card) instance ids. */
    permanent: Record<string, AnchorPoint>;
    /** Player ids. */
    player: Record<string, AnchorPoint>;
    /** Graveyard owner (player) ids. */
    graveyard: Record<string, AnchorPoint>;
};

/** Arrow category. `target` = stack item → its target (1-hop highlight on
 *  hover). `combat` = blocker → the attacker it blocks (transitive cluster
 *  highlight on hover, so a whole combat knot lights up together). */
export type ArrowKind = "target" | "combat";

/** One resolved arrow: a stable key, both endpoints, and a precomputed curved
 *  SVG path string connecting them. */
export type TargetArrow = {
    key: string;
    kind: ArrowKind;
    /** Source node id (stack item id for targets, blocker permanent id for
     *  combat) — used to resolve hover highlight incidence. */
    fromId: string;
    /** Target node id (target id for targets, attacker permanent id for
     *  combat). */
    toId: string;
    /** Connected-combat-component id; same for every arrow in one combat knot
     *  (banding-aware). `undefined` for `target` arrows. */
    clusterId?: string;
    /** Source (stack item / blocker) center. */
    from: AnchorPoint;
    /** Target center. */
    to: AnchorPoint;
    /** Quadratic-bezier `d` attribute from `from` to `to`. */
    path: string;
};

/** Empty registry — convenient default before any zone has published. */
export function emptyAnchorMap(): AnchorMap {
    return { stack: {}, permanent: {}, player: {}, graveyard: {} };
}

/** Resolve one stack target to its anchor point, or `null` if no anchor exists
 *  for it yet (zone not measured, owner unknown, etc.). Exhaustive over the
 *  `StackItem["targets"][n].type` union (CR target categories). */
function resolveTarget(
    target: NonNullable<StackItem["targets"]>[number],
    anchors: AnchorMap
): AnchorPoint | null {
    switch (target.type) {
        case "permanent":
            return anchors.permanent[target.id] ?? null;
        case "player":
            return anchors.player[target.id] ?? null;
        case "spell":
            return anchors.stack[target.id] ?? null;
        case "graveyard-card":
            return target.playerId
                ? (anchors.graveyard[target.playerId] ?? null)
                : null;
        case "hand-card":
            // issue #1101 — `TargetSelection.type` grew a "hand-card" member
            // for `lookDistribute`'s internal `bind` resolution, but it is never a
            // real ANNOUNCED target (CR 601.2c): `selectTarget` /
            // `getLegalTargets` never produce it, so no stack item's
            // `targets[]` ever actually carries one. No anchor to draw an
            // arrow to.
            return null;
        default: {
            // Exhaustiveness guard: a new target type must be handled here.
            const _exhaustive: never = target.type;
            return _exhaustive;
        }
    }
}

/**
 * Where a stack item's target arrows START.
 *
 * A **spell** is the object on the stack, so its arrows leave the stack row.
 * An **ability** is not: its source permanent is still sitting on the
 * battlefield (CR 602.2a / 603.3), and that is the object the player reads the
 * effect as coming from — "Arc Mage is shooting these two things", not "row 2
 * of the stack panel is". So an ability's arrows originate at its source
 * permanent, falling back to the stack row when the source has no anchor (it
 * left the battlefield, or the trigger came from a non-permanent source).
 *
 * An activated ability's stack item is a clone of its source instance, so it
 * carries the source's own id; a triggered ability records it separately in
 * `triggerSourceId` (its stack-item id is synthetic).
 */
function resolveArrowSource(
    item: StackItem,
    anchors: AnchorMap
): { id: string; point: AnchorPoint } | null {
    const isAbility = !!item.abilityId || !!item.triggeredAbilityId;
    if (isAbility) {
        const sourceId = item.triggerSourceId ?? item.id;
        const onBoard = anchors.permanent[sourceId];
        // The node id follows the endpoint, so hovering the source permanent
        // lights the arrows it actually emits.
        if (onBoard) return { id: sourceId, point: onBoard };
    }
    const row = anchors.stack[item.id];
    return row ? { id: item.id, point: row } : null;
}

/**
 * Build the arrow set for the current stack from resolved anchor points.
 *
 * One arrow per `(stack item → target)` pair — every target, not just the
 * last: a divide-as-you-choose spell (Arc Lightning's three) draws one arrow
 * each. A pair is skipped when either endpoint has no anchor yet (the registry
 * hasn't published it), so partially laid-out boards never draw an arrow into
 * the origin. Arrow keys are stable across renders so React reconciles rather
 * than remounts as placements move.
 */
export function buildTargetArrows(
    stack: StackItem[],
    anchors: AnchorMap
): TargetArrow[] {
    const arrows: TargetArrow[] = [];
    for (const item of stack) {
        if (!item.targets || item.targets.length === 0) continue;
        const source = resolveArrowSource(item, anchors);
        if (!source) continue;
        const from = source.point;
        for (const target of item.targets) {
            const to = resolveTarget(target, anchors);
            if (!to) continue;
            arrows.push({
                key: `${item.id}->${target.type}:${target.id}:${
                    target.playerId ?? ""
                }`,
                kind: "target",
                fromId: source.id,
                toId: target.id,
                from,
                to,
                path: arrowPath(from, to),
            });
        }
    }
    return arrows;
}

/**
 * Build the combat arrows for the current combat:
 *
 * - one arrow per `(blocker → attacker)` pair, drawn from the blocker's
 *   anchor to the attacker it blocks (CR 509 — a blocker points at what it
 *   stops). Both endpoints are battlefield permanents, so anchors come from
 *   the `permanent` bucket.
 * - one arrow per declared attacker → its attack target (CR 508.1a): the
 *   planeswalker named in `combat.attackTargets`, or the DEFENDING player's
 *   nameplate anchor (`defenderId`) when no planeswalker is chosen. This is
 *   the QA ask: while attack targets can still be chosen, every directed
 *   attacker shows where it is going — and it stays up through blocks/damage
 *   so the defender reads who is attacked at a glance.
 *
 * Each arrow carries a `clusterId`: the id of its connected combat component
 * (union-find over the block graph, with banded attackers unioned via
 * `combat.bands`). Hovering any arrow in a knot highlights the whole knot —
 * the transitive read the spaghetti of a multi-block / banding combat needs.
 * An attack-direction arrow joins its attacker's cluster, so hovering a
 * blocker also lights what the blocked attacker is swinging at.
 */
export function buildCombatArrows(
    combat: Combat | undefined,
    anchors: AnchorMap,
    defenderId?: string | null
): TargetArrow[] {
    if (!combat) return [];
    const assignments = combat.blockerAssignments ?? {};

    // Union-find over attacker/blocker ids; band members are unioned so a band
    // sharing blockers collapses into one cluster (CR 702.22).
    const parent: Record<string, string> = {};
    const find = (a: string): string => {
        parent[a] ??= a;
        let r = a;
        while (parent[r] !== r) r = parent[r];
        // path-compress
        let c = a;
        while (parent[c] !== r) {
            const n = parent[c];
            parent[c] = r;
            c = n;
        }
        return r;
    };
    const union = (a: string, b: string) => {
        parent[find(a)] = find(b);
    };
    for (const [attacker, blockers] of Object.entries(assignments)) {
        find(attacker);
        for (const blocker of blockers) union(blocker, attacker);
    }
    for (const band of combat.bands ?? []) {
        const [first, ...rest] = band.memberIds;
        if (first) for (const m of rest) union(m, first);
    }

    const arrows: TargetArrow[] = [];
    for (const [attacker, blockers] of Object.entries(assignments)) {
        const to = anchors.permanent[attacker];
        if (!to) continue;
        for (const blocker of blockers) {
            const from = anchors.permanent[blocker];
            if (!from) continue;
            arrows.push({
                key: `block:${blocker}->${attacker}`,
                kind: "combat",
                fromId: blocker,
                toId: attacker,
                clusterId: find(attacker),
                from,
                to,
                path: arrowPath(from, to),
            });
        }
    }

    // Attack-direction arrows (QA / CR 508.1a): attacker → chosen planeswalker
    // (`combat.attackTargets`), or → the defending player's nameplate anchor.
    // A skipped endpoint (anchor not published yet) skips only that arrow.
    for (const attacker of combat.attackerIds ?? []) {
        const from = anchors.permanent[attacker];
        if (!from) continue;
        const pwId = combat.attackTargets?.[attacker];
        const targetId = pwId ?? defenderId;
        if (!targetId) continue;
        const to = pwId ? anchors.permanent[pwId] : anchors.player[targetId];
        if (!to) continue;
        arrows.push({
            key: `attack:${attacker}->${targetId}`,
            kind: "combat",
            fromId: attacker,
            toId: targetId,
            clusterId: find(attacker),
            from,
            to,
            path: arrowPath(from, to),
        });
    }
    return arrows;
}

/** One manual arrow input (issue #2171): just the two permanent endpoints a
 *  player shift-dragged between — a raw pointer pair, not a pre-built
 *  {@link TargetArrow}, because only the anchor registry inside `BoardArrows`
 *  (published by the shared layout) can resolve an instance id to a board
 *  point. Resolving it here, alongside `buildCombatArrows`, means a manual
 *  arrow tracks a moving/animating card exactly like a target or combat
 *  arrow — no separate geometry path. */
export type ManualArrowPair = {
    key: string;
    fromId: string;
    toId: string;
};

/**
 * Build the arrow set for Manual Mode's player-declared arrows (issue #2171):
 * a flat permanent → permanent pointer pair, resolved the same way combat
 * arrows are — both endpoints looked up in `anchors.permanent`. Kept as
 * `kind: "target"` deliberately: the hover semantics that kind already gets
 * (peer-to-peer, directional, non-transitive — CR has no rule here, this is a
 * player convention) are exactly right for "this card is pointing at that
 * one." A pair with either endpoint unpublished (not on the battlefield /
 * anchor not measured yet) is skipped, same as every other arrow builder.
 */
export function buildManualArrows(
    pairs: ManualArrowPair[],
    anchors: AnchorMap
): TargetArrow[] {
    const arrows: TargetArrow[] = [];
    for (const pair of pairs) {
        const from = anchors.permanent[pair.fromId];
        const to = anchors.permanent[pair.toId];
        if (!from || !to) continue;
        arrows.push({
            key: pair.key,
            kind: "target",
            fromId: pair.fromId,
            toId: pair.toId,
            from,
            to,
            path: arrowPath(from, to),
        });
    }
    return arrows;
}

/** All arrows in the combat cluster `clusterId`, with their endpoint nodes. */
function combatCluster(
    arrows: TargetArrow[],
    clusterId: string
): { keys: Set<string>; nodes: Set<string> } {
    const keys = new Set<string>();
    const nodes = new Set<string>();
    for (const a of arrows) {
        if (a.kind === "combat" && a.clusterId === clusterId) {
            keys.add(a.key);
            nodes.add(a.fromId);
            nodes.add(a.toId);
        }
    }
    return { keys, nodes };
}

/**
 * Resolve which arrows are highlighted when `hovered` is the focused arrow or a
 * hovered board node. Pure so it is unit-testable. Two relationship shapes:
 *
 * - **combat** (transitive cluster): hovering a combat arrow OR any creature in
 *   a combat knot lights the WHOLE banding-aware cluster.
 * - **target / stack** (peer-to-peer, NOT transitive — and **directional**):
 *     - hovering a *target arrow* lights **only that arrow** + its two
 *       endpoints — it does not chain to other arrows that share an endpoint
 *       (hover `A→B` ⇒ {A, B, A→B}, even if `C→A` also exists);
 *     - hovering a *node* shows **what that node is involved with in its own
 *       direction**: a node that is a *source* (a stack item with targets — it
 *       is the `fromId` of ≥1 target arrow) lights only its **outgoing** arrows
 *       (what it targets); any other node (a permanent / player only ever
 *       targeted) lights its **incoming** arrows (what targets it). So with
 *       `A→B` (bolt→bears) and `C→A` (counter→bolt): hover `A` (a source) ⇒
 *       {A, B, A→B} — the counter `C→A` stays dim; hover `C` ⇒ {A, C, C→A};
 *       hover `B` ⇒ {A, B, A→B}.
 *
 * Returns `null` when nothing is hovered, or when a hovered node has no arrow
 * at all (an unrelated permanent) — so the caller dims nothing and only the
 * card's own preview/tilt reacts.
 */
export function resolveArrowHighlight(
    arrows: TargetArrow[],
    hovered: { key: string } | { nodeId: string } | null
): { keys: Set<string>; nodes: Set<string> } | null {
    if (!hovered) return null;

    if ("key" in hovered) {
        const a = arrows.find((x) => x.key === hovered.key);
        if (!a) return null;
        // Combat arrow → whole cluster; target arrow → just this peer pair.
        if (a.kind === "combat" && a.clusterId !== undefined) {
            return combatCluster(arrows, a.clusterId);
        }
        return {
            keys: new Set([a.key]),
            nodes: new Set([a.fromId, a.toId]),
        };
    }

    const id = hovered.nodeId;
    // A node sitting in a combat knot lights the whole cluster.
    const inCombat = arrows.find(
        (x) => x.kind === "combat" && (x.fromId === id || x.toId === id)
    );
    if (inCombat?.clusterId !== undefined) {
        return combatCluster(arrows, inCombat.clusterId);
    }

    // Directional over the target graph. A node that is a source (the `fromId`
    // of any target arrow — i.e. a stack item with targets) shows its OUTGOING
    // arrows; any other node shows its INCOMING arrows.
    const isSource = arrows.some((a) => a.kind === "target" && a.fromId === id);
    const keys = new Set<string>();
    const nodes = new Set<string>([id]);
    for (const a of arrows) {
        if (a.kind !== "target") continue;
        const hit = isSource ? a.fromId === id : a.toId === id;
        if (hit) {
            keys.add(a.key);
            nodes.add(a.fromId);
            nodes.add(a.toId);
        }
    }
    if (keys.size === 0) return null;
    return { keys, nodes };
}

/** Curvature of the arrow as a fraction of the chord length: the control point
 *  is offset perpendicular to the chord by this × |chord|. Gives the "fluid"
 *  bowed look the leader-line arrows had, recomputed analytically each frame. */
const ARROW_BOW_FRACTION = 0.18;

/**
 * Quadratic-bezier path from `from` to `to`, bowed perpendicular to the chord
 * so overlapping arrows separate visually. Pure function of the two endpoints —
 * recomputed every time a placement changes, which is what keeps the arrow
 * glued to a continuously-animating card with no DOM sampling.
 */
export function arrowPath(from: AnchorPoint, to: AnchorPoint): string {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    if (len === 0) {
        return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }
    // Perpendicular unit vector (-dy, dx) / len, scaled by the bow distance.
    const bow = len * ARROW_BOW_FRACTION;
    const cx = mx + (-dy / len) * bow;
    const cy = my + (dx / len) * bow;
    return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}
