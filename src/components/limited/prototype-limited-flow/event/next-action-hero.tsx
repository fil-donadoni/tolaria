// PROTOTYPE — throwaway. The NEXT ACTION hero: eyebrow, headline, one line,
// ONE big CTA. `card` = framed tile with art wash; `bare` = no frame (sits on
// the table's felt in variant B); `rail` = narrow column in variant C.
import { ArrowRight } from "lucide-react";
import { getArtCropImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import { EVENT_META } from "./event-mock";
import { nextActionFor } from "./event-next-action";
import type { EventProto } from "./use-event-proto";

const TONE = {
    accent: "text-accent-strong",
    success: "text-success-strong",
    muted: "text-text-muted",
} as const;

export default function NextActionHero({
    p,
    look = "card",
    className,
}: {
    p: EventProto;
    look?: "card" | "bare" | "rail";
    className?: string;
}) {
    const a = nextActionFor(p);
    const body = (
        <div
            className={cn(
                "relative flex flex-col gap-2",
                look === "bare" && "items-center text-center",
                look === "card" && "p-5 sm:p-6"
            )}
        >
            <span
                className={cn(
                    "text-[10px] font-bold uppercase tracking-[0.18em]",
                    TONE[a.tone]
                )}
            >
                {a.eyebrow}
            </span>
            <h2
                className={cn(
                    "font-display leading-[1.05] text-parchment",
                    look === "card"
                        ? "text-3xl sm:text-4xl"
                        : "text-2xl md:text-3xl"
                )}
            >
                {a.title}
            </h2>
            <p
                className={cn(
                    "text-sm text-text-muted",
                    look === "bare" ? "max-w-[22rem]" : "max-w-prose"
                )}
            >
                {a.line}
            </p>
            <div
                className={cn(
                    "mt-2 flex flex-wrap items-center gap-x-4 gap-y-2",
                    look === "bare" && "justify-center",
                    look === "rail" && "flex-col items-stretch"
                )}
            >
                <button
                    type="button"
                    onClick={a.onCta}
                    className={cn(
                        "btn-base btn-tone-primary inline-flex min-h-12 items-center justify-center gap-2 px-6 text-base",
                        look === "card" && "w-full sm:w-auto",
                        look === "rail" && "w-full"
                    )}
                >
                    {a.cta}
                    <ArrowRight className="size-4" />
                </button>
                {a.aside && (
                    <button
                        type="button"
                        onClick={a.aside.onClick}
                        className="text-xs text-text-muted underline-offset-4 hover:text-parchment hover:underline"
                    >
                        {a.aside.label}
                    </button>
                )}
            </div>
        </div>
    );
    if (look !== "card") return <div className={className}>{body}</div>;
    return (
        <section
            aria-label="Next action"
            className={cn(
                "relative isolate overflow-hidden rounded-[var(--panel-radius)] border border-accent/40 bg-surface shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_12px_40px_-12px_rgba(0,0,0,0.6)]",
                className
            )}
        >
            <img
                src={getArtCropImageUrl(EVENT_META.featureCard.id)}
                alt=""
                className="absolute inset-y-0 right-0 -z-10 h-full w-2/3 object-cover opacity-25 [mask-image:linear-gradient(90deg,transparent,black_70%)]"
            />
            {body}
        </section>
    );
}
