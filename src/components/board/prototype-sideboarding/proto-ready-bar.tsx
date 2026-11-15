// PROTOTYPE — throwaway. Ready dock (round 3, "bottom bar more visible, the
// CTA above all when active"). Three blocks read left → right as the decision:
//   1. deck status — the size check the CTA depends on, stated in words
//   2. play / draw — the loser's choice, a big two-option switch
//   3. opponent + the CTA — a tall ivory plate that GLOWS when it can fire;
//      blocked, it turns into a red "add N more" statement instead of a grey
//      dead button; after Ready it says what we are waiting for.
import { AlertTriangle, ArrowRight, Check, Loader2 } from "lucide-react";
import SideboardOpponentStatus from "../sideboard-opponent-status";
import type { ProtoVariantProps } from "./proto-types";
import { cn } from "~/lib/utils";

const GLOW_CSS = `
@keyframes proto-cta-glow {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 0%, transparent), 0 10px 30px -10px color-mix(in srgb, var(--color-accent) 55%, transparent); }
  50%      { box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-accent) 22%, transparent), 0 10px 34px -8px color-mix(in srgb, var(--color-accent) 75%, transparent); }
}
@media (prefers-reduced-motion: reduce) { .proto-cta-glow { animation: none !important; } }
`;

export default function ProtoReadyBar({
    p,
}: {
    p: ProtoVariantProps;
    leading?: React.ReactNode;
}) {
    const ins = p.pool.reduce((n, r) => n + Math.max(0, r.delta), 0);
    const outs = p.pool.reduce((n, r) => n + Math.max(0, -r.delta), 0);
    const missing = p.lockedSize - p.mainCount;
    const canFire = p.sizeOk && !p.submitting;
    return (
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-6">
            <style>{GLOW_CSS}</style>
            {/* 1 — deck status */}
            <div className="flex min-w-0 items-center gap-3">
                <span
                    className={cn(
                        "flex size-8 shrink-0 md:size-10 items-center justify-center rounded-full border-2",
                        p.sizeOk
                            ? "border-success/70 bg-success-soft text-success-strong"
                            : "border-danger/70 bg-danger-soft text-danger-strong"
                    )}
                >
                    {p.sizeOk ? (
                        <Check className="size-5" strokeWidth={3} />
                    ) : (
                        <AlertTriangle className="size-5" />
                    )}
                </span>
                <div className="min-w-0">
                    <div className="text-base font-semibold text-parchment tabular-nums">
                        Maindeck {p.mainCount}
                        <span className="font-normal text-text-muted">
                            {" "}
                            / {p.lockedSize}+
                        </span>
                    </div>
                    <div
                        className={cn(
                            "text-xs tabular-nums",
                            p.sizeOk ? "text-text-muted" : "text-danger-strong"
                        )}
                    >
                        {!p.sizeOk
                            ? `${missing} ${missing === 1 ? "card" : "cards"} short — bring ${missing === 1 ? "one" : "some"} back in`
                            : ins + outs === 0
                              ? "Same deck as last game"
                              : `${ins} in · ${outs} out · Sideboard ${p.sideCount}`}
                    </div>
                </div>
                {/* phone: opponent rides the status row to save a line */}
                <div className="ml-auto flex items-center gap-2 md:hidden">
                    {p.countdown}
                    {p.opponent && (
                        <SideboardOpponentStatus opponent={p.opponent} />
                    )}
                </div>
            </div>

            {/* 2 — play / draw */}
            {p.isChooser && (
                <div className="flex flex-col gap-1 md:ml-auto">
                    <span className="hidden text-[11px] uppercase tracking-wide text-text-muted md:inline">
                        You lost game {p.gameNumber - 1} — you choose
                    </span>
                    <div
                        role="radiogroup"
                        aria-label="Play or draw first"
                        className="flex rounded-lg border border-border-strong bg-surface-base p-1"
                    >
                        {(["play", "draw"] as const).map((v) => (
                            <button
                                key={v}
                                type="button"
                                role="radio"
                                aria-checked={p.playDraw === v}
                                disabled={p.submitting}
                                onClick={() => p.setPlayDraw(v)}
                                className={cn(
                                    "flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors md:min-w-28",
                                    p.playDraw === v
                                        ? "bg-surface-elevated text-parchment shadow-[inset_0_0_0_1px_var(--color-accent)]"
                                        : "text-text-muted hover:text-parchment"
                                )}
                            >
                                {v === "play" ? "Play first" : "Draw first"}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 3 — opponent + CTA */}
            <div
                className={cn(
                    "flex flex-col gap-2 md:items-end",
                    !p.isChooser && "md:ml-auto"
                )}
            >
                <div className="hidden items-center gap-3 md:flex md:justify-end">
                    {p.countdown}
                    {p.opponent && (
                        <SideboardOpponentStatus opponent={p.opponent} />
                    )}
                </div>
                <button
                    type="button"
                    onClick={p.onReady}
                    disabled={!canFire}
                    className={cn(
                        "flex h-12 w-full items-center justify-center gap-2 rounded-lg px-6 text-base font-semibold transition-[background,transform] md:w-auto md:min-w-72",
                        canFire &&
                            "proto-cta-glow bg-accent text-surface-base hover:bg-accent-strong active:scale-[0.98] animate-[proto-cta-glow_2.4s_ease-in-out_infinite]",
                        !p.sizeOk &&
                            !p.submitting &&
                            "cursor-not-allowed border-2 border-danger/70 bg-danger-soft text-danger-strong",
                        p.submitting &&
                            "cursor-default border border-border-strong bg-surface-elevated text-text-muted"
                    )}
                >
                    {p.submitting ? (
                        <>
                            <Loader2 className="size-4 animate-spin" />
                            Ready — waiting for {p.opponent?.name ?? "opponent"}
                            …
                        </>
                    ) : p.sizeOk ? (
                        <>
                            Ready for game {p.gameNumber}
                            <ArrowRight className="size-5" strokeWidth={2.5} />
                        </>
                    ) : (
                        <>
                            <AlertTriangle className="size-4" />
                            Add {missing} more to Maindeck
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
