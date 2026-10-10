// PROTOTYPE — throwaway. A deck's colours as mana symbols (real SVGs).
import ManaSymbol from "~/components/cards/mana-symbol";
import { cn } from "~/lib/utils";

export default function ManaPips({
    colors,
    size = "sm",
    className,
}: {
    colors: string[];
    size?: "xs" | "sm" | "md";
    className?: string;
}) {
    if (colors.length === 0) return null;
    const s = size === "xs" ? "size-3.5" : size === "sm" ? "size-4" : "size-5";
    return (
        <span
            className={cn("inline-flex items-center gap-0.5", className)}
            title={`Deck colours: ${colors.join("")}`}
        >
            {colors.map((c) => (
                <ManaSymbol
                    key={c}
                    symbol={c}
                    className={cn(s, "drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]")}
                />
            ))}
        </span>
    );
}
