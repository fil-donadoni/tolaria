// PROTOTYPE (issue #9500) — D: the choice sits ON the creature choosing: a
// small menu above it, one button per legal destination (the opponent, each
// planeswalker). Nameplate / planeswalker clicks still work too.
import { createPortal } from "react-dom";
import { useAttackTargetChooser } from "~/hooks/useAttackTargetChoice";
import { permanentRect, type SeqModel } from "./use-attack-seq-model";
import { useRafTick } from "./use-raf-tick";

export default function VariantDInline({ model }: { model: SeqModel }) {
    useRafTick(true);
    const chooser = useAttackTargetChooser();
    const cur = model.current;
    if (!cur) return null;
    const rect = permanentRect(cur.card.id);
    if (!rect) return null;
    const btn =
        "pointer-events-auto rounded-md bg-surface-elevated px-2.5 py-1 text-xs font-medium text-text ring-1 ring-white/20 hover:bg-accent-strong hover:text-black";
    return createPortal(
        <div
            className="fixed z-[90] flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1"
            style={{ left: rect.left + rect.width / 2, top: rect.top - 6 }}
        >
            <div className="flex flex-col gap-1 rounded-lg bg-black/85 p-1.5 shadow-xl">
                <div className="px-1 text-center text-[10px] text-white/70">
                    {cur.name} attacks…
                    {model.total > 1 && ` (${cur.n}/${model.total})`}
                </div>
                <button
                    type="button"
                    className={btn}
                    onClick={() => chooser.assign({ kind: "player" })}
                >
                    {model.opponentName}
                </button>
                {model.planeswalkers.map((pw) => (
                    <button
                        key={pw.id}
                        type="button"
                        className={btn}
                        onClick={() =>
                            chooser.assign({
                                kind: "planeswalker",
                                planeswalkerId: pw.id,
                            })
                        }
                    >
                        {pw.name}
                    </button>
                ))}
            </div>
            <div className="h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-black/85" />
        </div>,
        document.body
    );
}
