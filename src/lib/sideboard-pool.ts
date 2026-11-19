// The Sideboarding window's view model (issue #9820): the Maindeck + Sideboard
// split folded into ONE row per distinct card, with its copies in each zone,
// its Maindeck count when the window opened, and the type group it cascades
// under. Pure — the dialog renders it, the split helpers in `./deckSideboard`
// change it.
import type { PointerEvent, RefObject } from "react";
import { tryGetDefinition } from "@convex/cards";
import { isLandDefinition, manaValue } from "@convex/gre/constants";
import type { ZoneCard } from "~/types/game";
import {
    moveAllToMaindeck,
    moveAllToSideboard,
    moveToMaindeck,
    moveToSideboard,
    type SideboardSplit,
} from "./deckSideboard";

/** The two piles of the window. */
export type SideboardZone = "main" | "side";

/** The type columns the Maindeck cascades in, in display order. */
export const SIDEBOARD_GROUPS = [
    "Creatures",
    "Spells",
    "Artifacts",
    "Lands",
] as const;
export type SideboardGroup = (typeof SIDEBOARD_GROUPS)[number];

/** One distinct card of the pool (Maindeck + Sideboard together). */
export type SideboardPoolRow = {
    cardId: string;
    name: string;
    /** Copies in the Maindeck now. */
    main: number;
    /** Copies in the Sideboard now. */
    side: number;
    /** Copies in the Maindeck when the window opened. */
    startMain: number;
    /** `main - startMain`: > 0 brought in, < 0 taken out. */
    delta: number;
    group: SideboardGroup;
    mv: number;
};

/** Lands first by type (a land creature is a Land: it plays as a land drop),
 *  then creatures, instants/sorceries, and every other permanent. */
function groupOf(cardId: string): SideboardGroup {
    const def = tryGetDefinition(cardId);
    if (!def) return "Artifacts";
    if (isLandDefinition(def)) return "Lands";
    if (def.types.includes("Creature")) return "Creatures";
    if (def.types.includes("Instant") || def.types.includes("Sorcery"))
        return "Spells";
    return "Artifacts";
}

/** Fold the window's opening split and its current split into pool rows,
 *  sorted by group, then mana value, then name. A card present in either
 *  split has a row, even when it now sits wholly in one zone. */
export function buildSideboardPool(
    start: SideboardSplit,
    now: SideboardSplit
): SideboardPoolRow[] {
    const rows = new Map<string, SideboardPoolRow>();
    const row = (c: ZoneCard): SideboardPoolRow => {
        let r = rows.get(c.cardId);
        if (!r) {
            r = {
                cardId: c.cardId,
                name: c.cardName,
                main: 0,
                side: 0,
                startMain: 0,
                delta: 0,
                group: groupOf(c.cardId),
                mv: manaValue(tryGetDefinition(c.cardId)?.manaCost),
            };
            rows.set(c.cardId, r);
        }
        return r;
    };
    for (const c of start.cards) row(c).startMain += 1;
    for (const c of start.sideboard) row(c);
    for (const c of now.cards) row(c).main += 1;
    for (const c of now.sideboard) row(c).side += 1;
    const out = [...rows.values()];
    for (const r of out) r.delta = r.main - r.startMain;
    return out.sort(
        (a, b) =>
            SIDEBOARD_GROUPS.indexOf(a.group) -
                SIDEBOARD_GROUPS.indexOf(b.group) ||
            a.mv - b.mv ||
            a.name.localeCompare(b.name)
    );
}

/** The non-empty type groups of `rows`, in display order. */
export function groupSideboardRows(
    rows: readonly SideboardPoolRow[]
): { group: SideboardGroup; rows: SideboardPoolRow[] }[] {
    return SIDEBOARD_GROUPS.map((group) => ({
        group,
        rows: rows.filter((r) => r.group === group),
    })).filter((g) => g.rows.length > 0);
}

/** Copies of `row` in `zone`. */
export function copiesIn(row: SideboardPoolRow, zone: SideboardZone): number {
    return zone === "main" ? row.main : row.side;
}

/** The other pile. */
export function otherZone(zone: SideboardZone): SideboardZone {
    return zone === "main" ? "side" : "main";
}

/** The zone's display name. */
export function zoneName(zone: SideboardZone): "Maindeck" | "Sideboard" {
    return zone === "main" ? "Maindeck" : "Sideboard";
}

/** Move one copy (or every copy, `all`) of `cardId` INTO `to`. */
export function moveCopies(
    split: SideboardSplit,
    cardId: string,
    to: SideboardZone,
    all: boolean
): SideboardSplit {
    if (to === "side")
        return all
            ? moveAllToSideboard(split, cardId)
            : moveToSideboard(split, cardId);
    return all
        ? moveAllToMaindeck(split, cardId)
        : moveToMaindeck(split, cardId);
}

/** Copies brought in / taken out this window, summed over the pool. */
export function sideboardChangeTotals(rows: readonly SideboardPoolRow[]): {
    ins: number;
    outs: number;
} {
    let ins = 0;
    let outs = 0;
    for (const r of rows) {
        if (r.delta > 0) ins += r.delta;
        else outs -= r.delta;
    }
    return { ins, outs };
}

/** What every card tile of the window shares (issue #9820): focus for the
 *  inspector, the tap / drag gestures, and the lock while Ready is in flight. */
export type SideboardTileHandlers = {
    focusId?: string;
    onFocus: (cardId: string) => void;
    /** Move one copy (or every copy, `all`) of `cardId` INTO `to`. */
    onMove: (cardId: string, to: SideboardZone, all: boolean) => void;
    onDragStart: (e: PointerEvent, cardId: string, from: SideboardZone) => void;
    /** True for the click that ends a drag or a long-press. */
    suppressClick: RefObject<boolean>;
    draggingId?: string;
    disabled: boolean;
};

/** How a card's copies in `zone` changed this window, zone-relative: copies
 *  ARRIVED here (`gained`), some LEFT while the rest stayed (`reduced`), or
 *  untouched (`same`). The ×N badge's colour carries it. */
export function zoneChange(
    row: SideboardPoolRow,
    zone: SideboardZone
): "gained" | "reduced" | "same" {
    const inward = zone === "main" ? row.delta : -row.delta;
    return inward > 0 ? "gained" : inward < 0 ? "reduced" : "same";
}

/** Box shadow drawing one physical edge per extra copy (up to three) under a
 *  pile of `copies`, `step` px apart. */
export function pileEdgeShadow(copies: number, step = 2): string {
    if (copies < 2) return "0 2px 6px rgba(0,0,0,.5)";
    return Array.from({ length: Math.min(copies - 1, 3) }, (_, k) => {
        const o = (k + 1) * step;
        return `${o}px ${o}px 0 -1px rgba(0,0,0,.55), ${o}px ${o}px 0 0 rgba(255,255,255,.12)`;
    }).join(",");
}

/** A live card drag (issue #9820): which card, from where, where the pointer
 *  is and what it is over. `overAll` = the pointer is on an "All N" pad. */
export type SideboardDrag = {
    cardId: string;
    from: SideboardZone;
    x: number;
    y: number;
    shift: boolean;
    over: SideboardZone | null;
    overAll: boolean;
};

/** The drop the gesture would make right now, in words. */
export function sideboardDragLabel(
    drag: SideboardDrag,
    row: SideboardPoolRow
): string {
    const pile = copiesIn(row, drag.from);
    const to = zoneName(otherZone(drag.from));
    const valid = drag.over !== null && drag.over !== drag.from;
    if (!valid) return `Drag to ${to}`;
    return pile > 1 && (drag.overAll || drag.shift)
        ? `All ${pile} → ${to}`
        : `1 copy → ${to}`;
}
