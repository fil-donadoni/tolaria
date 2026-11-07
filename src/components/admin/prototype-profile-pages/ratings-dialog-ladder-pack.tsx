// PROTOTYPE — throwaway. The owner's pick (2026-11-07): the ladder IS the
// dialog, the pack test an accessory one tab (or `p`) away, kept to see whether
// it earns its place. The tab survives Next, so a pass can stay on either.
import { useEffect, useState } from "react";
import {
    RatingDialogShell,
    type RatingDialogProps,
} from "./ratings-dialog-shared";
import { LadderBody } from "./ratings-dialog-ladder";
import { PackBody } from "./ratings-dialog-pack";
import { topOfPackChance } from "./ratings-dialog-utils";

const TABS = [
    { key: "ladder", label: "Ladder" },
    { key: "pack", label: "Pack test" },
] as const;

export default function RatingsDialogLadderPack(props: RatingDialogProps) {
    const { card, all } = props;
    const [tab, setTab] = useState<"ladder" | "pack">("ladder");
    const open = card !== null;
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            const t = e.target;
            if (t instanceof Element && t.closest("input, textarea")) return;
            if (e.key === "p")
                setTab((x) => (x === "ladder" ? "pack" : "ladder"));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);
    return (
        <RatingDialogShell props={props}>
            {card && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-1 border-b border-border-subtle/30 pb-2">
                        {TABS.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                aria-pressed={tab === t.key}
                                onClick={() => setTab(t.key)}
                                className={
                                    "rounded-sm px-2.5 py-0.5 text-xs transition " +
                                    (tab === t.key
                                        ? "bg-accent/30 text-parchment"
                                        : "text-text-muted hover:bg-surface-elevated/50 hover:text-text")
                                }
                            >
                                {t.label}
                            </button>
                        ))}
                        <span className="ml-2 text-[10px] text-text-disabled">
                            p switches
                        </span>
                        <span
                            className="ml-auto text-xs text-text-muted"
                            title="Share of random 15-card packs of this scope with no higher-rated card, ties counted as top."
                        >
                            Top of a random pack{" "}
                            <span className="font-mono text-parchment">
                                {Math.round(topOfPackChance(all, card) * 100)}%
                            </span>
                        </span>
                    </div>
                    {tab === "ladder" ? (
                        <LadderBody {...props} />
                    ) : (
                        <PackBody {...props} />
                    )}
                </div>
            )}
        </RatingDialogShell>
    );
}
