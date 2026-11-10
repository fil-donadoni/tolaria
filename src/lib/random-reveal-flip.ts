import type { FlipRecord } from "@convex/gre/types";
import type { PendingChoice } from "~/types/game";

/** Presentation of one coin of a Random Reveal (CR 705.2): the halo/caption
 *  tone and the caption text. A win/lose flip is green/red; a face-only flip
 *  (`outcome: "none"`) reads heads as green and tails as red. The caption is
 *  viewer-relative for the flipper ("You win the flip") and names anyone else. */
export function flipTone(flip: Pick<FlipRecord, "face" | "outcome">) {
    if (flip.outcome === "win") return "good" as const;
    if (flip.outcome === "lose") return "bad" as const;
    return flip.face === "heads" ? ("good" as const) : ("bad" as const);
}

export function flipCaption(
    flip: Pick<FlipRecord, "face" | "outcome">,
    flipperName: string,
    isFlipper: boolean
): string {
    if (flip.outcome === "none")
        return flip.face === "heads" ? "Heads" : "Tails";
    const verb = flip.outcome === "win" ? "win" : "lose";
    return isFlipper
        ? `You ${verb} the flip`
        : `${flipperName} ${verb}s the flip`;
}

/** Badge on the source row: a spell resolves as its own type, anything else
 *  that flips a coin is an ability of that permanent. */
export function sourceKindLabel(types: readonly string[] | undefined): string {
    const spell = types?.find((t) => t === "Instant" || t === "Sorcery");
    if (spell) return spell.toUpperCase();
    return "TRIGGERED ABILITY";
}

/** The tosses a reveal plays: one per round of its Flip Sequence. A reveal
 *  saved before the list existed is one flip. */
export function revealRounds(choice: Pick<PendingChoice, "flips">): number {
    const flips = choice.flips;
    if (!flips || flips.length === 0) return 1;
    return Math.max(...flips.map((flip) => flip.round)) + 1;
}

/** The flips of round `round`, in draw order. */
export function flipsOfRound(
    flips: readonly FlipRecord[],
    round: number
): FlipRecord[] {
    return flips.filter((flip) => flip.round === round);
}

/** Caption of one landed round in the history: "1 · Win", "2 · Lose"; a
 *  face-only flip names its face. */
export function historyCaption(
    flip: Pick<FlipRecord, "face" | "outcome">,
    round: number
): string {
    const label =
        flip.outcome === "none"
            ? flip.face === "heads"
                ? "Heads"
                : "Tails"
            : flip.outcome === "win"
              ? "Win"
              : "Lose";
    return `${round + 1} · ${label}`;
}
