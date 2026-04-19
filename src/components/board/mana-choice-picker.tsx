import type { ManaCost } from "~/types/cards";

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
                    if (!color) return null;
                    return (
                        <button
                            key={color}
                            className="flex size-8 items-center justify-center rounded-full cursor-pointer transition-transform hover:scale-110"
                            onClick={() => onSelect(i)}
                            title={`Add ${amount}{${color}}`}
                        >
                            <img
                                src={`/img/symbols/${color}.svg`}
                                alt={color}
                                className="size-7"
                            />
                        </button>
                    );
                })}
            </div>
        </>
    );
}
