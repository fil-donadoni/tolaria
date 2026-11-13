// The position deep link's search parameters, read into `uiSeam.loadPosition`
// args (issue #9272, ADR 0180). Seam code only: imported by the position page,
// which only a DEV bundle registers.

export interface UiSeamPositionArgs {
    label: string;
    unlessAt?: { gameId: string; seq: number };
}

/** `null` when the label is missing or blank. A repeat guard that is not
 *  `<gameId>@<non-negative integer>` is dropped rather than guessed at:
 *  without it the position is simply loaded again — slower, never wrong. */
export function readUiSeamPositionArgs(
    rawLabel: unknown,
    rawUnlessAt: unknown
): UiSeamPositionArgs | null {
    if (typeof rawLabel !== "string" || rawLabel.trim() === "") return null;
    const match =
        typeof rawUnlessAt === "string"
            ? /^([^@\s]+)@(\d+)$/.exec(rawUnlessAt)
            : null;
    return match
        ? {
              label: rawLabel,
              unlessAt: { gameId: match[1], seq: Number(match[2]) },
          }
        : { label: rawLabel };
}
