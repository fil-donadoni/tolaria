// Ornamental divider: two tapering gold rules meeting a centred diamond node
// (issue #595). Material lives in `.divider-line` / `.divider-node`
// (index.css).
import { cn } from "@/lib/utils";

export default function OrnamentalDivider({
    className,
}: {
    className?: string;
}) {
    return (
        <div
            data-slot="ornamental-divider"
            className={cn("flex items-center gap-2 py-1", className)}
        >
            <span className="divider-line h-px flex-1" />
            <span className="divider-node h-2 w-2 rotate-45" />
            <span className="divider-line h-px flex-1" />
        </div>
    );
}
