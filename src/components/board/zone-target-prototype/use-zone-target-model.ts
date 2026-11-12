// PROTOTYPE (zone-target highlight) — throwaway, never merged (branch
// prototype/zone-target-highlight). Derives "which cards in which zone are
// targeted by which stack item" + live viewport anchors for the overlays.
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
export type ZoneKind = "graveyard" | "exile";

export type ZoneTargetGroup = {
    key: string;
    sourceLabel: string;
    sourceStackId: string | null;
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

function centerOf(sel: string): Pt | null {
    // The same anchor can render twice (chip + pile); take the visible one.
    for (const el of Array.from(document.querySelectorAll(sel))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
}

export type Anchors = {
    source: Pt;
    sourceIsStack: boolean;
    zone: Pt | null;
};

/** Polls DOM anchors every frame — prototype-grade, no registry plumbing. */
export function useAnchors(groups: ZoneTargetGroup[]) {
    const [anchors, setAnchors] = useState<Record<string, Anchors>>({});
    useEffect(() => {
        let raf = 0;
        let last = "";
        const tick = () => {
            const next: Record<string, Anchors> = {};
            for (const g of groups) {
                const stackPt = g.sourceStackId
                    ? centerOf(
                          `[data-arrow-anchor-stack="${CSS.escape(g.sourceStackId)}"]`
                      )
                    : null;
                next[g.key] = {
                    source: stackPt ?? {
                        x: window.innerWidth / 2,
                        y: window.innerHeight * 0.45,
                    },
                    sourceIsStack: !!stackPt,
                    zone: centerOf(
                        `[data-arrow-anchor-${g.zone}="${CSS.escape(g.ownerId)}"]`
                    ),
                };
            }
            const s = JSON.stringify(next);
            if (s !== last) {
                last = s;
                setAnchors(next);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [groups]);
    return anchors;
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

/** Several stack items can target cards in the SAME zone: lay them out as one
 *  row per zone. Per group: the index of its first card in that row and the
 *  row's total length. */
export function zoneSlots(
    groups: ZoneTargetGroup[]
): Record<string, { start: number; total: number; zoneKey: string }> {
    const totals = new Map<string, number>();
    const out: Record<
        string,
        { start: number; total: number; zoneKey: string }
    > = {};
    for (const g of groups) {
        const zk = `${g.ownerId}:${g.zone}`;
        const start = totals.get(zk) ?? 0;
        out[g.key] = { start, total: 0, zoneKey: zk };
        totals.set(zk, start + g.cards.length);
    }
    for (const g of groups) out[g.key].total = totals.get(out[g.key].zoneKey)!;
    return out;
}

export type ZoneCluster = {
    zoneKey: string;
    zone: ZoneKind;
    ownerLabel: string;
    at: Pt;
    /** Targeted cards in this zone, each with the stack item(s) naming it. */
    targets: Array<{ card: CardInstance; sources: string[] }>;
    zoneCards: CardInstance[];
};

/** Merge every group pointing into the same zone into ONE cluster. */
export function zoneClusters(
    groups: ZoneTargetGroup[],
    anchors: Record<string, Anchors>
): ZoneCluster[] {
    const out = new Map<string, ZoneCluster>();
    for (const g of groups) {
        const at = anchors[g.key]?.zone;
        if (!at) continue;
        const zk = `${g.ownerId}:${g.zone}`;
        const c =
            out.get(zk) ??
            ({
                zoneKey: zk,
                zone: g.zone,
                ownerLabel: g.ownerLabel,
                at,
                targets: [],
                zoneCards: g.zoneCards,
            } satisfies ZoneCluster);
        for (const card of g.cards) {
            const hit = c.targets.find((t) => t.card.id === card.id);
            if (hit) hit.sources.push(g.sourceLabel);
            else c.targets.push({ card, sources: [g.sourceLabel] });
        }
        out.set(zk, c);
    }
    return Array.from(out.values());
}
