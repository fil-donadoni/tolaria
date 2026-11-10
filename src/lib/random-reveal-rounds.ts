import type { FlipFace, FlipFaceDamage, FlipRecord } from "@convex/gre/types";

/** Presentation of a Flip Sequence in which several players flip each round
 *  (CR 705.2 — Mana Clash: "You and target opponent each flip a coin … Repeat
 *  this process …"). Client-only, viewer-relative; the outcome was drawn and
 *  persisted server-side. */

/** Who flips each round, in draw order: the order of the round's coins. */
export function roundFlipperIds(flips: readonly FlipRecord[]): string[] {
    return [...new Set(flips.map((flip) => flip.flipperId))];
}

/** Caption of one coin of an effect that deals damage per face: "Heads — no
 *  damage", "Tails — 1 damage" (CR 705.2: nobody wins or loses a face-only
 *  flip, so the caption names the face and what it costs, never a winner). */
export function faceDamageCaption(
    face: FlipFace,
    faceDamage: FlipFaceDamage
): string {
    const label = face === "heads" ? "Heads" : "Tails";
    const amount = faceDamage[face];
    return amount > 0 ? `${label} — ${amount} damage` : `${label} — no damage`;
}

/** The damage the given flips deal their flipper, in total. */
export function flipperDamage(
    flips: readonly FlipRecord[],
    flipperId: string,
    faceDamage: FlipFaceDamage
): number {
    return flips
        .filter((flip) => flip.flipperId === flipperId)
        .reduce((total, flip) => total + faceDamage[flip.face], 0);
}

/** The number of rounds the flips span. */
export function roundCount(flips: readonly FlipRecord[]): number {
    if (flips.length === 0) return 0;
    return Math.max(...flips.map((flip) => flip.round)) + 1;
}

/** The consequence line of a finished clash, viewer-relative: "4 rounds — you
 *  take 2 damage, Bot takes 2." Seats in flip order. */
export function roundsDamageConsequence(
    flips: readonly FlipRecord[],
    faceDamage: FlipFaceDamage,
    nameOf: (id: string) => string,
    viewerId: string
): string {
    const rounds = roundCount(flips);
    const seats = roundFlipperIds(flips).map((id, i) => {
        const taken = flipperDamage(flips, id, faceDamage);
        const who = id === viewerId ? "you take" : `${nameOf(id)} takes`;
        return `${who} ${taken}${i === 0 ? " damage" : ""}`;
    });
    return `${rounds} ${rounds === 1 ? "round" : "rounds"} — ${seats.join(", ")}.`;
}
