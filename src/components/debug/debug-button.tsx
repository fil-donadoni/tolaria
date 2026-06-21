export default function DebugButton({
    onClick,
    children,
    variant = "default",
    disabled = false,
}: {
    onClick: () => void;
    children: React.ReactNode;
    variant?: "default" | "danger";
    disabled?: boolean;
}) {
    const base =
        "rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
    const styles =
        variant === "danger"
            ? "bg-red-900/50 text-red-300 hover:bg-red-900/80"
            : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white";

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${base} ${styles}`}
        >
            {children}
        </button>
    );
}
