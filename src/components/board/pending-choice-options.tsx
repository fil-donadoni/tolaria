import { Button } from "~/components/ui/button";

/** Option buttons for an `option-pick` pending choice (CR 614.12 — "as it
 *  enters, choose …"). Each author-supplied option renders one button; the
 *  chooser picks exactly one, which submits immediately. Used by the
 *  choose-body-on-entry creatures (Primal Clay's 3 body modes, Shapeshifter's
 *  number 0–7). Stateless — the parent owns the submit + pending state. */
export default function PendingChoiceOptions({
    options,
    disabled,
    onPick,
}: {
    options: { id: string; label: string }[];
    disabled: boolean;
    onPick: (id: string) => void;
}) {
    return (
        <div className="flex flex-wrap justify-center gap-2 mt-1">
            {options.map((opt) => (
                <Button
                    key={opt.id}
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onPick(opt.id)}
                >
                    {opt.label}
                </Button>
            ))}
        </div>
    );
}
