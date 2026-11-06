// The rounding rule for a value a test derives by subtracting two valuations.
//
// A difference of two sums carries floating-point noise that depends on the
// weights, so an exact assertion on it can flip on any refit.
//
// The rule is 11 decimals, and the number is not arbitrary. A fitted weight has
// 6 decimals and every `REMOVAL_COMPLETENESS` denominator divides 32, so a price
// is a multiple of 1e-6 / 32 = 3125e-11: it lies ON the 1e-11 grid. No true value
// can then sit on a rounding boundary, and noise (about 1e-13 at these
// magnitudes, against the 5e-12 to the nearest boundary) cannot push one value to
// a different grid point than its twin. A coarser grid has no such guarantee:
// 6 decimals would split a price ending in exactly ...5 at the seventh.

const POINTS_GRID_PER_UNIT = 1e11;

/** Both sides of an exact assertion on a derived difference go through this. */
export function roundToPointsGrid(points: number): number {
    return Math.round(points * POINTS_GRID_PER_UNIT) / POINTS_GRID_PER_UNIT;
}

const POINTS_SUBTRACTION = /\.points\s*-\s*[\w$.]*\.points/;
const ROUNDING_CALL = "roundToPointsGrid(";

/** 1-indexed lines subtracting two `.points` outside the rounding rule. A line
 *  wrapped by the formatter counts when the call opens on the line before. */
export function findUnroundedPointsSubtractions(source: string): number[] {
    const lines = source.split("\n");
    const found: number[] = [];
    lines.forEach((line, i) => {
        if (!POINTS_SUBTRACTION.test(line)) return;
        if (line.includes(ROUNDING_CALL)) return;
        if ((lines[i - 1] ?? "").trimEnd().endsWith(ROUNDING_CALL)) return;
        found.push(i + 1);
    });
    return found;
}
