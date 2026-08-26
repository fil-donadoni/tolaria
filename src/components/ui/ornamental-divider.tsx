// Ornamental divider: a rule with a centred diamond node (issue #595).
// Material lives in `.divider-line` / `.divider-node` (index.css).
//
// ADR 0103 §5 makes this THE one surviving ornament atom — corner brackets and
// corner filigree left `Panel` in issue #2723, and this is what a waiting
// state (lobby hero, Game Over, Match Result) reaches for instead. The shape
// is fixed on purpose: no variants, no sizes, no tones. An ornament with knobs
// is how the v3 frame ended up with a 40px mode that overlapped dialog titles
// and a 10px mode that did not.
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
