// Four corner filigrees positioned at the corners of a container (issue #595).
//
// Default mode wraps `children` in a `relative` box. `overlay` mode instead
// stretches absolutely to the nearest positioned ancestor, so the four corners
// land on that panel's actual corners — use it to frame an existing `relative`
// panel. The overlay container is `inset-0` (not zero-height), avoiding the
// collapse bug a self-sizing wrapper would cause.
import CornerFiligree from "./corner-filigree";

export default function CornerFiligreeFrame({
    children,
    size = 40,
    subtle = false,
    overlay = false,
}: {
    children?: React.ReactNode;
    size?: number;
    subtle?: boolean;
    overlay?: boolean;
}) {
    return (
        <div
            data-slot="corner-filigree-frame"
            className={
                overlay ? "pointer-events-none absolute inset-0" : "relative"
            }
        >
            <CornerFiligree corner="tl" size={size} subtle={subtle} />
            <CornerFiligree corner="tr" size={size} subtle={subtle} />
            <CornerFiligree corner="bl" size={size} subtle={subtle} />
            <CornerFiligree corner="br" size={size} subtle={subtle} />
            {children}
        </div>
    );
}
