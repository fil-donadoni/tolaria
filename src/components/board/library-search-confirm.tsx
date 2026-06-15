import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";

/** Confirm control for the `search-library` picker, rendered inside the
 *  library dialog. The dialog opens as a modal (`forceOpen`) and covers the
 *  board-level PendingChoicePrompt, so the chooser needs a reachable Done
 *  button here to commit the buffered selection (ADR 0007). Disabled until
 *  the buffer holds at least `min` cards; the picker caps it at `max`. */
export default function LibrarySearchConfirm({
    min,
    max,
}: {
    min: number;
    max: number;
}) {
    const { buffer, submit, isPending } = usePendingChoiceBuffer();
    const selected = buffer.length;
    const canSubmit = selected >= min && selected <= max;
    const label =
        min === 0 && selected === 0 ? "Skip" : `Done (${selected}/${max})`;

    return (
        <button
            type="button"
            disabled={!canSubmit || isPending}
            onClick={() => submit()}
            className="px-4 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-[#7a5a2e]/30 border border-[#c8a060]/45 text-[#e0c08a] hover:bg-[#7a5a2e]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
            {label}
        </button>
    );
}
