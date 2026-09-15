// A `ScenarioSpec` read as a board (issue #3577, PRD #3574, ADR 0128 §12).
//
// The ONE reading of a spec as a position, shared by every surface that shows
// one — the scenario preview and the verdict quiz today, the admin re-judging
// surface next. A second renderer is how two surfaces come to disagree about
// what a position was.
//
// HANDS ARE A COUNT UNLESS A CALLER REVEALS THEM. The verdict quiz reveals the
// deciding seat's hand behind a consent toggle and never the opponent's: the
// spec carries the opponent's hand as a size (`hiddenHand`, issue #3452),
// which is what the Bot knew. The count is enforced HERE rather than by the
// spec's shape, so a hand-typed spec that names an unrevealed seat's hand
// cards still renders as a number.

import type { ScenarioCard, ScenarioSpec } from "@convex/debugScenarioSpec";

export type ScenarioSeat = "me" | "opp";

/** The zones a board shows as card lists, in reading order. The library is a
 *  count on the spec and not a position fact anyone judges by. */
export const SCENARIO_BOARD_ZONES = [
    "battlefield",
    "graveyard",
    "exile",
] as const;

export type ScenarioBoardZoneName = (typeof SCENARIO_BOARD_ZONES)[number];

export type ScenarioBoardEntry = {
    name: string;
    /** `count` on the spec — N identical copies declared as one entry. */
    count: number;
    /** Short state markers: tapped, summoning sick, counters, damage, … */
    notes: string[];
};

export type ScenarioBoardZone = {
    zone: ScenarioBoardZoneName;
    entries: ScenarioBoardEntry[];
};

export type ScenarioBoardHand =
    | {
          revealed: true;
          size: number;
          entries: ScenarioBoardEntry[];
          /** Opaque cards (`hiddenHand`) in the size but not in `entries` —
           *  said out loud, so a short list does not read as a broken one. */
          unseen: number;
      }
    | { revealed: false; size: number };

export type ScenarioBoardSeat = {
    seat: ScenarioSeat;
    life?: number;
    hand: ScenarioBoardHand;
    zones: ScenarioBoardZone[];
};

export type ScenarioBoard = {
    phase?: string;
    turn?: number;
    /** Basic lands the builder seeds on BOTH battlefields (`landCount`). */
    seededLands: number;
    /** Opponent first, then the deciding seat — the way a board is read. */
    seats: ScenarioBoardSeat[];
    /** TOP-DOWN: the first entry resolves first. The spec stores it
     *  bottom-up (`ScenarioSpec.stack`, CR 608.1). */
    stack: { name: string; controller: ScenarioSeat }[];
};

function entryNotes(card: ScenarioCard): string[] {
    const notes: string[] = [];
    if (card.token) notes.push("token");
    if (card.faceDown || card.faceDownExile) notes.push("face down");
    if (card.tapped) notes.push("tapped");
    if (card.summoningSick) notes.push("sick");
    if (card.attachedTo) notes.push(`on ${card.attachedTo}`);
    if (card.damageMarked) notes.push(`${card.damageMarked} damage`);
    for (const [kind, amount] of Object.entries(card.counters ?? {})) {
        notes.push(`${amount}× ${kind}`);
    }
    return notes;
}

function toEntry(card: ScenarioCard): ScenarioBoardEntry {
    return {
        name: card.name,
        count: card.count ?? 1,
        notes: entryNotes(card),
    };
}

function sizeOf(entries: ScenarioBoardEntry[]): number {
    return entries.reduce((sum, entry) => sum + entry.count, 0);
}

function seatBoard(
    spec: ScenarioSpec,
    seat: ScenarioSeat,
    revealed: boolean
): ScenarioBoardSeat {
    const mine = spec.cards.filter((card) => card.owner === seat);
    const handEntries = mine
        .filter((card) => card.zone === "hand")
        .map(toEntry);
    const unseen = spec.hiddenHand?.[seat] ?? 0;
    const size = sizeOf(handEntries) + unseen;
    const life = spec.life?.[seat];
    return {
        seat,
        ...(life === undefined ? {} : { life }),
        // A revealed hand still carries `hiddenHand` in its size: opaque
        // cards the spec could not name are cards all the same.
        hand: revealed
            ? { revealed: true, size, entries: handEntries, unseen }
            : { revealed: false, size },
        zones: SCENARIO_BOARD_ZONES.map((zone) => ({
            zone,
            entries: mine
                // The builder places an entry with no zone on the battlefield.
                .filter((card) => (card.zone ?? "battlefield") === zone)
                .map(toEntry),
        })).filter((zone) => zone.entries.length > 0),
    };
}

/**
 * Read a spec as a board. `revealedHands` names the seats whose hand is shown
 * as cards; every other seat's hand is a size and nothing more.
 */
export function scenarioBoard(
    spec: ScenarioSpec,
    revealedHands: readonly ScenarioSeat[]
): ScenarioBoard {
    return {
        ...(spec.phase === undefined ? {} : { phase: spec.phase }),
        ...(spec.turn === undefined ? {} : { turn: spec.turn }),
        seededLands: spec.landCount ?? 0,
        seats: (["opp", "me"] as const).map((seat) =>
            seatBoard(spec, seat, revealedHands.includes(seat))
        ),
        stack: [...(spec.stack ?? [])]
            .reverse()
            .map((item) => ({ name: item.name, controller: item.controller })),
    };
}
