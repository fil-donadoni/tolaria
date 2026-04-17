export default function ActionButton({
    onClick,
    label,
    color = "red",
    disabled = false,
}: {
    onClick: () => void;
    label: string;
    color?: "red" | "blue" | "gray";
    disabled?: boolean;
}) {
    const colors = {
        red: "bg-red-600 hover:bg-red-500 text-white",
        blue: "bg-blue-600 hover:bg-blue-500 text-white",
        gray: "bg-gray-600 text-gray-400 cursor-not-allowed",
    };
    return (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40">
            <button
                onClick={onClick}
                disabled={disabled}
                className={`font-bold px-4 py-1 rounded-lg text-sm transition-colors ${
                    disabled ? colors.gray : colors[color]
                }`}
            >
                {label}
            </button>
        </div>
    );
}
