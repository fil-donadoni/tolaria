import { cn } from "~/lib/utils";
import { symbolName, symbolSrc } from "~/lib/symbol-names";

type ManaSymbolProps = {
    symbol: string;
    className?: string;
};

/** One symbol image, from the one symbol mapping (issue #9834): its `alt` is
 *  the spoken name ("R" → "red mana"), never the brace token. */
export default function ManaSymbol({ symbol, className }: ManaSymbolProps) {
    return (
        <img
            src={symbolSrc(symbol)}
            alt={symbolName(symbol) ?? symbol}
            data-symbol={`{${symbol}}`}
            className={cn("inline size-6 align-[-0.15em]", className)}
            draggable={false}
        />
    );
}
