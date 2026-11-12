// PROTOTYPE (zone-target highlight) — throwaway, never merged (branch
// prototype/zone-target-highlight). Derives "which cards in which zone are
// targeted by which stack item" + live viewport geometry for the overlays.
//
// Real mode: reads `graveyard-card` targets off the real stack (the only zone
// target type the engine has today). Simulated scenarios: synthesize targets
// from the real graveyards / exile so every case is viewable without casting.
import { useEffect, useState } from "react";
import { tryGetDefinition } from "@convex/cards";
import { displayCardId } from "~/lib/card-utils";
import type { CardInstance, Player, StackItem } from "~/types/game";

export function protoName(c: CardInstance): string {
    return tryGetDefinition(displayCardId(c))?.name ?? "?";
}

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type ZoneKind = "graveyard" | "exile";

export type ZoneTargetGroup = {
    key: string;
    sourceLabel: string;
    sourceStackId: string | null;
    /** An ability's arrows leave its SOURCE PERMANENT (same rule as the real
     *  arrow layer); a spell's leave its stack row. */
    sourcePermanentId: string | null;
    zone: ZoneKind;
    ownerId: string;
    ownerLabel: string;
    cards: CardInstance[];
    /** Every card in that zone, in zone order (for the peek variant). */
    zoneCards: CardInstance[];
};

export type Scenario = { key: string; label: string };
export const SCENARIOS: Scenario[] = [
    { key: "real", label: "real stack" },
    { key: "one", label: "sim · 1 card, opp graveyard" },
    { key: "three", label: "sim · 3 cards, one graveyard" },
    { key: "split", label: "sim · 1 card in EACH graveyard" },
    { key: "exile", label: "sim · 1 card in exile" },
];

function ownerLabel(p: Player, viewerId: string) {
    return p.id === viewerId ? "your" : `${p.name}'s`;
}

function sourcePermanentOf(item: StackItem): string | null {
    const isAbility = !!item.abilityId || !!item.triggeredAbilityId;
    return isAbility ? (item.triggerSourceId ?? item.id) : null;
}

export function deriveGroups(
    scenario: string,
    stack: StackItem[],
    players: Player[],
    viewerId: string
): ZoneTargetGroup[] {
    const byId = new Map(players.map((p) => [p.id, p]));
    if (scenario === "real") {
        const groups: ZoneTargetGroup[] = [];
        for (const item of stack) {
            const perOwner = new Map<string, CardInstance[]>();
            for (const t of item.targets ?? []) {
                if (t.type !== "graveyard-card" || !t.playerId) continue;
                const owner = byId.get(t.playerId);
                const card = owner?.graveyard.find((c) => c.id === t.id);
                if (!card) continue;
                perOwner.set(t.playerId, [
                    ...(perOwner.get(t.playerId) ?? []),
                    card,
                ]);
            }
            for (const [ownerId, cards] of perOwner) {
                const owner = byId.get(ownerId)!;
                groups.push({
                    key: `${item.id}:${ownerId}`,
                    sourceLabel: protoName(item),
                    sourceStackId: item.id,
                    sourcePermanentId: sourcePermanentOf(item),
                    zone: "graveyard",
                    ownerId,
                    ownerLabel: ownerLabel(owner, viewerId),
                    cards,
                    zoneCards: owner.graveyard,
                });
            }
        }
        return groups;
    }
    const top = stack[stack.length - 1] ?? null;
    const src = {
        sourceLabel: top ? protoName(top) : "Simulated spell",
        sourceStackId: top?.id ?? null,
        sourcePermanentId: top ? sourcePermanentOf(top) : null,
    };
    const me = players.find((p) => p.id === viewerId) ?? players[0];
    const opp = players.find((p) => p.id !== me?.id) ?? me;
    const mk = (
        p: Player | undefined,
        zone: ZoneKind,
        n: number
    ): ZoneTargetGroup | null => {
        if (!p) return null;
        const zoneCards = zone === "graveyard" ? p.graveyard : p.exile;
        // Pick from the MIDDLE of the zone, never just the top card: the
        // interesting case is a target the pile's face doesn't show.
        const start = Math.max(0, Math.floor((zoneCards.length - n) / 2));
        const cards = zoneCards.slice(start, start + n);
        if (cards.length === 0) return null;
        return {
            key: `sim:${p.id}:${zone}`,
            ...src,
            zone,
            ownerId: p.id,
            ownerLabel: ownerLabel(p, viewerId),
            cards,
            zoneCards,
        };
    };
    const out =
        scenario === "one"
            ? [mk(opp, "graveyard", 1)]
            : scenario === "three"
              ? [mk(opp, "graveyard", 3) ?? mk(me, "graveyard", 3)]
              : scenario === "split"
                ? [mk(opp, "graveyard", 1), mk(me, "graveyard", 1)]
                : [mk(opp, "exile", 1) ?? mk(me, "exile", 1)];
    return out.filter((g): g is ZoneTargetGroup => g !== null);
}

/** First VISIBLE element matching `sel` (the same anchor can render twice). */
export function rectOf(sel: string): Rect | null {
    for (const el of Array.from(document.querySelectorAll(sel))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
            return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return null;
}

export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export type Anchors = {
    /** Where the arrows start: source permanent for abilities, else row. */
    source: Pt;
    sourceRect: Rect | null;
    /** The stack row, always (lit on focus even when arrows leave a permanent). */
    rowRect: Rect | null;
    zone: Pt | null;
    zoneRect: Rect | null;
};

const esc = (s: string) => CSS.escape(s);

/** Polls DOM geometry every frame — prototype-grade, no registry plumbing.
 *  `extra` = every `[data-proto-measure]` element (a variant's own chips /
 *  thumbnails it aims arrows at), keyed by that attribute. */
export function useAnchors(groups: ZoneTargetGroup[]) {
    const [state, setState] = useState<{
        anchors: Record<string, Anchors>;
        extra: Record<string, Rect>;
    }>({ anchors: {}, extra: {} });
    useEffect(() => {
        let raf = 0;
        let last = "";
        const tick = () => {
            const anchors: Record<string, Anchors> = {};
            for (const g of groups) {
                const rowRect = g.sourceStackId
                    ? rectOf(
                          `[data-arrow-anchor-stack="${esc(g.sourceStackId)}"]`
                      )
                    : null;
                const permRect = g.sourcePermanentId
                    ? rectOf(
                          `[data-arrow-anchor-permanent="${esc(g.sourcePermanentId)}"]`
                      )
                    : null;
                const sourceRect = permRect ?? rowRect;
                const zoneRect = rectOf(
                    `[data-arrow-anchor-${g.zone}="${esc(g.ownerId)}"]`
                );
                anchors[g.key] = {
                    source: sourceRect
                        ? center(sourceRect)
                        : {
                              x: window.innerWidth / 2,
                              y: window.innerHeight * 0.45,
                          },
                    sourceRect,
                    rowRect,
                    zone: zoneRect ? center(zoneRect) : null,
                    zoneRect,
                };
            }
            const ex: Record<string, Rect> = {};
            for (const el of Array.from(
                document.querySelectorAll("[data-proto-measure]")
            )) {
                const r = el.getBoundingClientRect();
                if (r.width > 0)
                    ex[el.getAttribute("data-proto-measure")!] = {
                        x: r.left,
                        y: r.top,
                        w: r.width,
                        h: r.height,
                    };
            }
            // The stack panel: overlays must not land on it.
            const stackRect = rectOf('[data-testid="game-stack"]');
            if (stackRect) ex["@stack"] = stackRect;
            const next = { anchors, extra: ex };
            const s = JSON.stringify(next);
            if (s !== last) {
                last = s;
                setState(next);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [groups]);
    return state;
}

/** Unit vector from the zone pile toward the viewport centre — overlays grow
 *  INTO the board, never off-screen. */
export function inward(p: Pt): Pt {
    const dx = window.innerWidth / 2 - p.x;
    const dy = window.innerHeight / 2 - p.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

export function curve(a: Pt, b: Pt, bend = 0.18): string {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const cx = mx - (b.y - a.y) * bend;
    const cy = my + (b.x - a.x) * bend;
    return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

export type ZoneCluster = {
    zoneKey: string;
    zone: ZoneKind;
    ownerLabel: string;
    at: Pt;
    zoneRect: Rect | null;
    /** Targeted cards in this zone, each with the group(s) naming it. */
    targets: Array<{ card: CardInstance; groupKeys: string[] }>;
    zoneCards: CardInstance[];
};

/** Merge every group pointing into the same zone into ONE cluster. */
export function zoneClusters(
    groups: ZoneTargetGroup[],
    anchors: Record<string, Anchors>
): ZoneCluster[] {
    const out = new Map<string, ZoneCluster>();
    for (const g of groups) {
        const a = anchors[g.key];
        if (!a?.zone) continue;
        const zk = `${g.ownerId}:${g.zone}`;
        const c: ZoneCluster = out.get(zk) ?? {
            zoneKey: zk,
            zone: g.zone,
            ownerLabel: g.ownerLabel,
            at: a.zone,
            zoneRect: a.zoneRect,
            targets: [],
            zoneCards: g.zoneCards,
        };
        for (const card of g.cards) {
            const hit = c.targets.find((t) => t.card.id === card.id);
            if (hit) hit.groupKeys.push(g.key);
            else c.targets.push({ card, groupKeys: [g.key] });
        }
        out.set(zk, c);
    }
    return Array.from(out.values());
}

export function zoneWord(z: ZoneKind) {
    return z === "graveyard" ? "graveyard" : "exile";
}
