import type { ManaCost } from "~/types/cards";

const MANA_SYMBOLS: Record<string, { label: string; bg: string }> = {
    W: { label: "W", bg: "bg-amber-100 text-amber-900 hover:bg-amber-200" },
    U: { label: "U", bg: "bg-blue-500 text-white hover:bg-blue-400" },
    B: { label: "B", bg: "bg-gray-800 text-white hover:bg-gray-700" },
    R: { label: "R", bg: "bg-red-500 text-white hover:bg-red-400" },
    G: { label: "G", bg: "bg-green-600 text-white hover:bg-green-500" },
};

type ManaChoicePickerProps = {
    choices: ManaCost[];
    position: { x: number; y: number };
    onSelect: (index: number) => void;
    onCancel: () => void;
};

export default function ManaChoicePicker({
    choices,
    position,
    onSelect,
    onCancel,
}: ManaChoicePickerProps) {
    return (
        <>
            <div className="fixed inset-0 z-40" onClick={onCancel} />
            <div
                className="fixed z-50 flex gap-1 rounded-lg bg-black/90 p-2 shadow-xl ring-1 ring-white/20"
                style={{ left: position.x, top: position.y }}
            >
                {choices.map((cost, i) => {
                    const color = Object.keys(cost).find(
                        (k) => k !== "X"
                    ) as string;
                    const amount = cost[color as keyof ManaCost];
                    const sym = MANA_SYMBOLS[color];
                    if (!sym) return null;
                    return (
                        <button
                            key={color}
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${sym.bg} cursor-pointer transition-colors`}
                            onClick={() => onSelect(i)}
                            title={`Add ${amount}${sym.label}`}
                        >
                            {sym.label}
                        </button>
                    );
                })}
            </div>
        </>
    );
}
