import type { FlipRecord } from "@convex/gre/types";

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
