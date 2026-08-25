// Epic Title Treatment (issue #597): a glowy DISPLAY-FACE headline flanked by
// clasp flourishes with a slowly-rotating runic ring behind it. For
// start/end-of-Game banners and other major messages — it floats, no panel box.
//
// v4 (ADR 0103 §4, issue #2723): the headline and the subtitle moved off
// Beleren onto the chrome display face via `.text-display` (Geist 500,
// -0.025em, lining tabular numerals). This component IS "the display-face
// large title" the ADR names, and it was one of the last chrome consumers
// still naming the retired Beleren utility — a class that resolves to nothing
// since #2722, so it already rendered as Geist with none of the treatment.
//
// The runic ring's rotation is reduced-motion-gated in CSS (`.runic-ring`,
// index.css); a later slice (#598) owns the broader motion pass. This component
// ships the markup so that pass has an element to animate.
import { cn } from "@/lib/utils";
import SubtitleFlourish from "./subtitle-flourish";

export default function TitleTreatment({
    title,
    subtitle,
    className,
}: {
    title: string;
    subtitle?: string;
    className?: string;
}) {
    return (
        <div
            data-slot="title-treatment"
            className={cn(
                "relative flex flex-col items-center py-6 text-center",
                className
            )}
        >
            {/* dark vignette that lifts the headline off the scene behind it */}
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                    background:
                        "radial-gradient(60% 80% at 50% 50%, rgba(0,0,0,0.45), transparent 70%)",
                }}
            />

            {/* slowly-rotating runic ring (rotation gated by reduced-motion) */}
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 grid place-items-center"
            >
                {/* Sized from the block's own height (never a fixed 176/208px
                    square): an oversized absolute child still contributes to
                    the ancestor's scrollable overflow, so inside a scrolling
                    dialog body the ring pushed the box over the edge — and its
                    rotation made the sub-pixel bounding box wobble, so the
                    scrollbars blinked in and out (QA, game-over screen). */}
                <span className="runic-ring aspect-square h-full max-h-52 rounded-full opacity-40" />
            </span>

            <h1 className="text-display title-treatment-glow relative text-4xl sm:text-5xl">
                {title}
            </h1>

            {subtitle && (
                <div className="relative mt-3 flex items-center gap-3">
                    <SubtitleFlourish side="left" />
                    <span className="text-display text-base text-parchment">
                        {subtitle}
                    </span>
                    <SubtitleFlourish side="right" />
                </div>
            )}
        </div>
    );
}
