// Sunburst icon well (Zelda TotK item-get): radial rays behind a centred glyph
// (issue #595). Visual recipe lives in `.sunburst-well` (index.css). Used by
// the gameplay dialog and hero plates.
import { cn } from "@/lib/utils";

export default function SunburstIcon({
    children,
    size = 72,
    className,
}: {
    children: React.ReactNode;
    size?: number;
    className?: string;
}) {
    return (
        <span
            data-slot="sunburst-icon"
            className={cn(
                "sunburst-well flex shrink-0 items-center justify-center rounded-md drop-shadow-[0_0_20px_rgba(201,162,75,0.4)]",
                className
            )}
            style={{ width: size, height: size }}
        >
            {children}
        </span>
    );
}
