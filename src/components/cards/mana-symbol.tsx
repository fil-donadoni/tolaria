import { cn } from "~/lib/utils";

type ManaSymbolProps = {
    symbol: string;
    className?: string;
};

export default function ManaSymbol({ symbol, className }: ManaSymbolProps) {
    const fileName = symbol.toUpperCase().replace(/\//g, "_");
    return (
        <img
            src={`/img/symbols/${fileName}.svg`}
            alt={`{${symbol}}`}
            className={cn("inline size-6 align-[-0.15em]", className)}
            draggable={false}
        />
    );
}
