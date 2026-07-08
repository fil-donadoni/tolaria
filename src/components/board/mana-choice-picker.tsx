import type { Color, ManaCost } from "~/types/cards";
import { colors } from "~/types/cards";

type ManaChoicePickerProps = {
    choices: ManaCost[];
    /** Anchor point (mouse coords). Omitted when the picker is opened without a
     *  pointer event (e.g. from the ability menu) — it then centres on screen
     *  instead of pinning to the top-left corner. */
    position?: { x: number; y: number };
    onSelect: (index: number) => void;
    onCancel: () => void;
};

export default function ManaChoicePicker({
    choices,
    position,
    onSelect,
    onCancel,
}: ManaChoicePickerProps) {
    const placement = position
        ? { left: position.x, top: position.y }
        : {
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
          };
    return (
        <>
            <div className="fixed inset-0 z-40" onClick={onCancel} />
            <div
                className="fixed z-100 flex gap-1 rounded-lg bg-black/90 p-2 shadow-xl ring-1 ring-white/20"
                style={placement}
            >
                {choices.map((cost, i) => {
                    // A choice may be a single pip ({B:2}) or a multi-colour
                    // combination ({U:1,B:1}). Expand every coloured pip so the
                    // button shows the full mana it produces, not just the first.
                    const pips: Color[] = colors.flatMap((c) =>
                        Array.from({ length: cost[c] ?? 0 }, () => c)
                    );
                    if (!pips.length) return null;
                    const title = `Add ${pips.map((c) => `{${c}}`).join("")}`;
                    return (
                        <button
                            key={i}
                            className="flex items-center gap-0.5 rounded-full bg-white/5 px-2 py-1 cursor-pointer ring-1 ring-white/15 transition-colors hover:bg-white/15"
                            onClick={() => onSelect(i)}
                            title={title}
                        >
                            {pips.map((c, p) => (
                                <img
                                    key={p}
                                    src={`/img/symbols/${c}.svg`}
                                    alt={c}
                                    className="size-6 shrink-0"
                                />
                            ))}
                        </button>
                    );
                })}
            </div>
        </>
    );
}
