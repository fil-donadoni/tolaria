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
                <button
                    key={opt.id}
                    type="button"
                    disabled={disabled}
                    className="px-3 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-[#7a5a2e]/30 border border-[#c8a060]/45 text-[#e0c08a] hover:bg-[#7a5a2e]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    onClick={() => onPick(opt.id)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}
