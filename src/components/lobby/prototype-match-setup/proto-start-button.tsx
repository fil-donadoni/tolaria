// PROTOTYPE — throwaway.
import { cn } from "~/lib/utils";

export default function ProtoStartButton({
    ready,
    onStart,
    label = "Start match →",
}: {
    ready: boolean;
    onStart: () => void;
    label?: string;
}) {
    return (
        <button
            type="button"
            disabled={!ready}
            onClick={onStart}
            className={cn(
                "rounded-sm px-4 py-2 text-sm font-semibold transition",
                ready
                    ? "bg-parchment text-surface-base hover:opacity-90"
                    : "cursor-not-allowed bg-surface-elevated/40 text-text-disabled"
            )}
        >
            {label}
        </button>
    );
}
