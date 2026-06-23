// Subtitle clasp flourish (Zelda BotW title clasp): a short gold rule ending in
// a small ring + diamond node (issue #595). `side` mirrors it so a pair can
// flank a centred subtitle. Material lives in `.divider-line` / `.divider-node`
// (index.css); the ring uses the accent token.

export default function SubtitleFlourish({ side }: { side: "left" | "right" }) {
    const node = (
        <span className="flex items-center gap-1.5 text-accent">
            <span className="divider-node h-1.5 w-1.5 rotate-45" />
            <span className="h-1.5 w-1.5 rounded-full border border-current" />
        </span>
    );
    return (
        <span
            data-slot="subtitle-flourish"
            data-side={side}
            className={`flex items-center gap-1.5 ${
                side === "right" ? "flex-row-reverse" : ""
            }`}
        >
            <span className="divider-line h-px w-8" />
            {node}
        </span>
    );
}
