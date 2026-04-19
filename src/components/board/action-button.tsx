type ActionButtonColor = "red" | "blue" | "amber" | "yellow" | "gray";

const COLOR_CLASSES: Record<ActionButtonColor, string> = {
    red: "bg-red-600 hover:bg-red-500 text-white",
    blue: "bg-blue-600 hover:bg-blue-500 text-white",
    amber: "bg-amber-500 hover:bg-amber-400 text-black",
    yellow: "bg-yellow-600 hover:bg-yellow-500 text-white",
    gray: "bg-gray-600 text-gray-300 cursor-not-allowed",
};

export default function ActionButton({
    onClick,
    label,
    color = "red",
    disabled = false,
    shortcut,
}: {
    onClick: () => void;
    label: string;
    color?: ActionButtonColor;
    disabled?: boolean;
    shortcut?: string;
}) {
    const colorClass = disabled ? COLOR_CLASSES.gray : COLOR_CLASSES[color];
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`font-bold px-6 py-2 rounded-lg text-sm transition-colors shadow-lg ${colorClass}`}
        >
            {label}
            {shortcut && (
                <span className="ml-2 text-xs opacity-60">[{shortcut}]</span>
            )}
        </button>
    );
}
