// PROTOTYPE (issue #9500) — B: a numbered badge on every attacker in the walk
// (current = accent + "choosing", done = its target, pending = number only).
import { createPortal } from "react-dom";
import { permanentRect, type SeqModel } from "./use-attack-seq-model";
import { useRafTick } from "./use-raf-tick";

export default function VariantBBadges({ model }: { model: SeqModel }) {
    useRafTick(true);
    return createPortal(
        <>
            {model.rows.map((r) => {
                const rect = permanentRect(r.card.id);
                if (!rect) return null;
                const cur = r.status === "current";
                return (
                    <div
                        key={r.card.id}
                        className="pointer-events-none fixed z-[90] flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-lg"
                        style={{
                            left: rect.left + rect.width / 2,
                            top: rect.top - 12,
                            background: cur
                                ? "var(--color-accent-strong)"
                                : "rgba(0,0,0,.8)",
                            color: cur ? "black" : "white",
                        }}
                    >
                        <span className="tabular-nums">{r.n}</span>
                        {cur && <span>choosing</span>}
                        {r.status === "done" && (
                            <span className="font-normal">
                                → {r.targetLabel}
                            </span>
                        )}
                    </div>
                );
            })}
        </>,
        document.body
    );
}
