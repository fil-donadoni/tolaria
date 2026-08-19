// PROTOTYPE — throwaway. Chamfer prompt A/B (D7, E33): the in-game choice
// prompt as a chamfered plate (A) vs the current rounded Panel (B), over a
// mock board, at every viewport. Pure look-and-feel; buttons only log.
import { useState } from "react";
import { cn } from "~/lib/utils";
import { getImageUrl } from "~/lib/images";
import { draftPack } from "./mock-pool";

import type { PromptVariant } from "./prompt-variants";

const OPTIONS = ["Gain 3 life", "Draw a card", "Deal 3 damage to any target"];

export default function TouchPromptSurface({
    variant,
}: {
    variant: PromptVariant;
}) {
    const [picked, setPicked] = useState<number | null>(null);
    const [cards] = useState(draftPack);
    const chamfer = variant === "A";
    return (
        <div className="fixed inset-0 bg-surface-base text-text select-none">
            {/* mock board */}
            <div className="absolute inset-0 flex flex-wrap content-end gap-2 p-6 opacity-40 blur-[1px]">
                {cards.slice(0, 10).map((c) => (
                    <img
                        key={c.key}
                        src={getImageUrl(c.cardId)}
                        alt=""
                        draggable={false}
                        className="w-[70px] rounded-[6%]"
                    />
                ))}
            </div>
            <div className="absolute inset-x-0 top-[18%] flex justify-center px-3">
                <div
                    className={cn(
                        "w-full max-w-[420px] bg-gradient-to-b from-surface-elevated to-surface p-[1px]",
                        chamfer
                            ? ""
                            : "rounded-xl border border-accent/50 shadow-[0_22px_50px_rgba(0,0,0,.7)]"
                    )}
                    style={
                        chamfer
                            ? {
                                  clipPath:
                                      "polygon(14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px),0 14px)",
                                  background:
                                      "linear-gradient(180deg,#ecc878,#6b5a36)",
                              }
                            : undefined
                    }
                >
                    <div
                        className={cn(
                            "flex flex-col gap-3 bg-gradient-to-b from-surface-elevated to-surface p-4",
                            chamfer ? "" : "rounded-xl"
                        )}
                        style={
                            chamfer
                                ? {
                                      clipPath:
                                          "polygon(13px 0,calc(100% - 13px) 0,100% 13px,100% calc(100% - 13px),calc(100% - 13px) 100%,13px 100%,0 calc(100% - 13px),0 13px)",
                                  }
                                : undefined
                        }
                    >
                        <div className="flex items-center gap-2">
                            <span className="font-beleren text-base tracking-wide text-parchment">
                                Choose one
                            </span>
                            <span className="text-xs text-text-muted">
                                · Charm · mode 1 of 1
                            </span>
                            <span className="flex-1" />
                            <span className="rounded-full border border-signal-pending px-2 text-[10px] uppercase tracking-wider text-signal-pending">
                                0:24
                            </span>
                        </div>
                        <div
                            className={cn(
                                "h-px",
                                chamfer
                                    ? "bg-gradient-to-r from-transparent via-accent to-transparent"
                                    : "bg-accent/40"
                            )}
                        />
                        <div className="flex flex-col gap-2">
                            {OPTIONS.map((o, i) => (
                                <button
                                    key={o}
                                    type="button"
                                    onClick={() => setPicked(i)}
                                    className={cn(
                                        "min-h-11 border px-4 text-left font-beleren text-sm tracking-wide",
                                        chamfer ? "" : "rounded-md",
                                        picked === i
                                            ? "border-accent bg-accent-soft text-accent-strong"
                                            : "border-accent/40 bg-surface-elevated text-text"
                                    )}
                                    style={
                                        chamfer
                                            ? {
                                                  clipPath:
                                                      "polygon(8px 0,calc(100% - 8px) 0,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0 calc(100% - 8px),0 8px)",
                                              }
                                            : undefined
                                    }
                                >
                                    {o}
                                </button>
                            ))}
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                type="button"
                                className={cn(
                                    "min-h-11 px-5 font-beleren text-sm",
                                    chamfer
                                        ? "[clip-path:polygon(10px_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,10px_100%,0_50%)] bg-accent text-surface-base"
                                        : "rounded-full bg-accent text-surface-base"
                                )}
                                disabled={picked === null}
                                style={{ opacity: picked === null ? 0.5 : 1 }}
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div className="absolute right-2 bottom-20 max-w-[50vw] text-right text-[11px] text-text-muted">
                {chamfer
                    ? "A — chamfered plate + arrow Confirm; brackets dropped"
                    : "B — today's rounded Panel + pill Confirm"}
            </div>
        </div>
    );
}
