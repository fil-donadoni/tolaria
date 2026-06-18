import type { CounterDisplay } from "~/lib/counters";

const TONE_TEXT: Record<string, string> = {
    buff: "text-emerald-400",
    debuff: "text-red-400",
    neutral: "text-amber-400",
};

/** Counters section of the card preview (CR 122). Lists every counter on the
 *  permanent with its label and count. Renders nothing when there are none. */
export default function CardPreviewCounters({
    counters,
}: {
    counters: CounterDisplay[];
}) {
    if (counters.length === 0) return null;

    return (
        <div className="border-t border-zinc-700 pt-2 text-sm">
            <div className="text-zinc-400 font-semibold mb-1">Counters</div>
            <ul className="flex flex-col gap-0.5">
                {counters.map((c) => (
                    <li
                        key={c.type}
                        className="flex justify-between items-baseline"
                    >
                        <span className={`font-semibold ${TONE_TEXT[c.tone]}`}>
                            {c.label}
                        </span>
                        <span className="text-white font-bold tabular-nums">
                            ×{c.count}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
