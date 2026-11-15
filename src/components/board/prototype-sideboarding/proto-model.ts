// PROTOTYPE — throwaway (prototype skill, UI branch). Shared swap model the
// three Sideboarding variants render. Only the rendering differs per variant.
import { tryGetDefinition } from "@convex/cards";
import { manaValue } from "@convex/gre/constants";
import type { ZoneCard } from "~/types/game";
import {
    moveAllToMaindeck,
    moveAllToSideboard,
    moveToMaindeck,
    moveToSideboard,
    type SideboardSplit,
} from "~/lib/deckSideboard";

export type ProtoGroup = "Creatures" | "Spells" | "Artifacts" | "Lands";
export const PROTO_GROUPS: ProtoGroup[] = [
    "Creatures",
    "Spells",
    "Artifacts",
    "Lands",
];

/** One distinct card of the pool (Maindeck + Sideboard together). */
export type PoolRow = {
    cardId: string;
    name: string;
    main: number;
    side: number;
    total: number;
    /** Copies in the Maindeck when the window opened. */
    startMain: number;
    /** main - startMain: >0 brought in, <0 taken out. */
    delta: number;
    group: ProtoGroup;
    mv: number;
    typeLine: string;
};

function groupOf(types: readonly string[]): ProtoGroup {
    if (types.includes("Land")) return "Lands";
    if (types.includes("Creature")) return "Creatures";
    if (types.includes("Instant") || types.includes("Sorcery")) return "Spells";
    return "Artifacts";
}

export function buildPool(
    start: SideboardSplit,
    now: SideboardSplit
): PoolRow[] {
    const order: string[] = [];
    const rows = new Map<string, PoolRow>();
    const touch = (c: ZoneCard) => {
        let r = rows.get(c.cardId);
        if (!r) {
            const def = tryGetDefinition(c.cardId);
            r = {
                cardId: c.cardId,
                name: c.cardName,
                main: 0,
                side: 0,
                total: 0,
                startMain: 0,
                delta: 0,
                group: groupOf(def?.types ?? []),
                mv: manaValue(def?.manaCost),
                typeLine: def
                    ? [def.supertypes?.join(" "), def.types.join(" ")]
                          .filter(Boolean)
                          .join(" ") +
                      (def.subtypes?.length
                          ? ` — ${def.subtypes.join(" ")}`
                          : "")
                    : "",
            };
            rows.set(c.cardId, r);
            order.push(c.cardId);
        }
        return r;
    };
    for (const c of start.cards) touch(c).startMain += 1;
    for (const c of start.sideboard) touch(c);
    for (const c of now.cards) touch(c).main += 1;
    for (const c of now.sideboard) touch(c).side += 1;
    const out = order.map((id) => rows.get(id)!);
    for (const r of out) {
        r.total = r.main + r.side;
        r.delta = r.main - r.startMain;
    }
    return out.sort(
        (a, b) =>
            PROTO_GROUPS.indexOf(a.group) - PROTO_GROUPS.indexOf(b.group) ||
            a.mv - b.mv ||
            a.name.localeCompare(b.name)
    );
}

export type Dir = "toSide" | "toMain";

export function moveOne(s: SideboardSplit, cardId: string, dir: Dir) {
    return dir === "toSide"
        ? moveToSideboard(s, cardId)
        : moveToMaindeck(s, cardId);
}

export function moveAll(s: SideboardSplit, cardId: string, dir: Dir) {
    return dir === "toSide"
        ? moveAllToSideboard(s, cardId)
        : moveAllToMaindeck(s, cardId);
}

export function moveN(
    s: SideboardSplit,
    cardId: string,
    dir: Dir,
    n: number
): SideboardSplit {
    let next = s;
    for (let i = 0; i < n; i++) next = moveOne(next, cardId, dir);
    return next;
}

/** Set exactly how many copies of `cardId` sit in the Maindeck. */
export function setMainCount(
    s: SideboardSplit,
    cardId: string,
    target: number
): SideboardSplit {
    const main = s.cards.filter((c) => c.cardId === cardId).length;
    return target > main
        ? moveN(s, cardId, "toMain", target - main)
        : moveN(s, cardId, "toSide", main - target);
}

export function groupBy<T extends { group: ProtoGroup }>(rows: T[]) {
    return PROTO_GROUPS.map((g) => ({
        group: g,
        rows: rows.filter((r) => r.group === g),
    })).filter((g) => g.rows.length > 0);
}

export function sumBy(rows: PoolRow[], k: "main" | "side") {
    return rows.reduce((n, r) => n + r[k], 0);
}
