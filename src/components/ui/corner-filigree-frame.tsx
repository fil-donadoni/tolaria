// Four corner filigrees positioned at the corners of a container (issue #595).
//
// Default mode wraps `children` in a `relative` box. `overlay` mode instead
// stretches absolutely to the nearest positioned ancestor, so the four corners
// land on that panel's actual corners — use it to frame an existing `relative`
// panel. The overlay container is `inset-0` (not zero-height), avoiding the
// collapse bug a self-sizing wrapper would cause.
import { cn } from "@/lib/utils";
import CornerFiligree from "./corner-filigree";

export default function CornerFiligreeFrame({
    children,
    size = 40,
    subtle = false,
    overlay = false,
    className,
}: {
    children?: React.ReactNode;
    size?: number;
    subtle?: boolean;
    overlay?: boolean;
    /** Extra classes merged onto the frame's own root — e.g. a variant like
     *  `short-viewport:hidden` to drop the ornament where vertical space is
     *  scarce (issue #2056 defect 3 amplification). Purely additive; every
     *  existing caller that omits it is unaffected. */
    className?: string;
}) {
    return (
        <div
            data-slot="corner-filigree-frame"
            className={cn(
                overlay ? "pointer-events-none absolute inset-0" : "relative",
                className
            )}
        >
            <CornerFiligree corner="tl" size={size} subtle={subtle} />
            <CornerFiligree corner="tr" size={size} subtle={subtle} />
            <CornerFiligree corner="bl" size={size} subtle={subtle} />
            <CornerFiligree corner="br" size={size} subtle={subtle} />
            {children}
        </div>
    );
}
