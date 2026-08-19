// Four Panel v3 corner brackets stretched over the nearest positioned ancestor
// (ADR 0101 §2, issue #2581).
//
// Always an overlay — unlike `CornerFiligreeFrame` there is no wrapping mode.
// A Panel is already `relative`, and a self-sizing wrapper is what caused the
// zero-height collapse the filigree frame documents.
import { cn } from "@/lib/utils";
import type { Corner } from "./corner-filigree";
import CornerBracket from "./corner-bracket";

const CORNERS: readonly Corner[] = ["tl", "tr", "bl", "br"];

export default function CornerBracketFrame({
    className,
}: {
    /** Extra classes on the frame root — e.g. the visibility gate that hides
     *  the brackets above 844x390 on a Panel that opted into rich ornament. */
    className?: string;
}) {
    return (
        <div
            data-slot="corner-bracket-frame"
            className={cn("pointer-events-none absolute inset-0", className)}
        >
            {CORNERS.map((corner) => (
                <CornerBracket key={corner} corner={corner} />
            ))}
        </div>
    );
}
