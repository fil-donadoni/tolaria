// PROTOTYPE (issue #9500) — replaces AttackDirectionBanner while a creature
// is choosing its attack target, one rendering per variant:
//   A — names the creature choosing + "2 of 5" + who comes next; fixed order.
//   B — same headline + "or select another attacker" (badges on the board).
//   C — a clickable queue strip of every attacker with its chosen target.
//   D — one short line; the choice itself sits on the creature (board overlay).
import { Swords } from "lucide-react";
import { Banner } from "~/components/ui/banner";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import ProtoThumb from "./proto-thumb";
import { useAttackSeqModel, type SeqRow } from "./use-attack-seq-model";

function headline(cur: SeqRow | null, total: number, active: boolean) {
    if (!cur) return null;
    return (
        <>
            <span className="font-semibold">{cur.name}</span>
            {active && total > 1 && (
                <span className="ml-1 rounded bg-accent-strong/20 px-1.5 text-xs tabular-nums">
                    {cur.n} of {total}
                </span>
            )}
            <span>: attack the opponent or a planeswalker?</span>
        </>
    );
}

export default function ProtoSeqBanner({ variant }: { variant: string }) {
    const model = useAttackSeqModel();
    const seq = useAttackSequence();
    if (!model) return null;
    const { rows, current, total } = model;
    const next = rows.filter((r) => r.status === "pending");

    if (variant === "D") {
        return (
            <Banner
                tone="info"
                icon={<Swords className="h-4 w-4 text-accent-strong" />}
                className="panel-physical pointer-events-none max-w-lg"
            >
                <span className="font-semibold">
                    Choose a target for each attacker
                </span>{" "}
                ({model.doneCount}/{total} done) — use the buttons on the
                highlighted creature, or select another attacker.
            </Banner>
        );
    }

    if (variant === "C") {
        return (
            <div className="panel-physical pointer-events-auto flex flex-col gap-2 rounded-lg bg-surface-elevated px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                    <Swords className="h-4 w-4 text-accent-strong" />
                    <span>
                        <span className="font-semibold">
                            Assign attack targets
                        </span>{" "}
                        — select the opponent&apos;s nameplate or a planeswalker
                        for the raised card. Select another card to switch.
                    </span>
                </div>
                <div className="flex items-end justify-center gap-2">
                    {rows.map((r) => (
                        <button
                            key={r.card.id}
                            type="button"
                            onClick={() => seq.jumpTo?.(r.card.id)}
                            className={`flex flex-col items-center gap-1 rounded-md p-1 transition ${
                                r.status === "current"
                                    ? "-translate-y-1 bg-accent-strong/25 ring-2 ring-accent-strong"
                                    : "opacity-80 hover:opacity-100"
                            }`}
                        >
                            <ProtoThumb
                                card={r.card}
                                width={r.status === "current" ? 56 : 44}
                            />
                            <span
                                className={`max-w-[72px] truncate rounded px-1 text-[10px] ${
                                    r.status === "done"
                                        ? "bg-surface-base text-text"
                                        : r.status === "current"
                                          ? "bg-accent-strong text-surface-base"
                                          : "text-text-muted"
                                }`}
                            >
                                {r.status === "done"
                                    ? `→ ${r.targetLabel}`
                                    : r.status === "current"
                                      ? "choosing…"
                                      : "next"}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    // A and B
    return (
        <Banner
            tone="info"
            icon={
                current ? (
                    <ProtoThumb card={current.card} width={34} />
                ) : (
                    <Swords className="h-4 w-4 text-accent-strong" />
                )
            }
            className="panel-physical pointer-events-none max-w-xl"
        >
            <div className="flex flex-col gap-0.5">
                <div>{headline(current, total, seq.active)}</div>
                <div className="text-xs text-text-muted">
                    Select the opponent&apos;s nameplate or a planeswalker.
                    {variant === "B"
                        ? " Or select another attacker to choose for it first."
                        : next.length > 0
                          ? ` Then: ${next.map((r) => r.name).join(", ")}.`
                          : " Last one."}
                </div>
            </div>
        </Banner>
    );
}
