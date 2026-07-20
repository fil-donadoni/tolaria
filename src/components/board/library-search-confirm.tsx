import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { Button } from "~/components/ui/button";

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
        <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canSubmit || isPending}
            onClick={() => submit()}
        >
            {label}
        </Button>
    );
}
