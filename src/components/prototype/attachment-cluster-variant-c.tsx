// PROTOTYPE — Variant C: COLLAPSED PROXY PILE.
// The whole cluster collapses to ONE mini-card pinned to the host's top-left
// corner (the topmost satellite), backed by offset "paper" rects that imply a
// pile, with a ×N badge and a tiny kind-dot legend (violet = aura, amber =
// exile). Most compact — leans entirely on the pile dialog for detail. Mirrors
// the >8 depth-pile collapse of the identical-permanent stack.
import { useState } from "react";
import type { MockHost } from "./mock-attachment-data";
import MockHostCard from "./mock-host-card";
import AttachmentPileDialog from "./attachment-pile-dialog";
import CardImage from "../cards/card-image";

const DOT: Record<string, string> = {
    aura: "bg-violet-400",
    exile: "bg-amber-400",
};

export default function AttachmentClusterVariantC({
    host,
}: {
    host: MockHost;
}) {
    const [open, setOpen] = useState(false);
    const n = host.attachments.length;
    const top = host.attachments[0];
    // Up to two paper layers behind the proxy hint depth without clutter.
    const layers = Math.min(n - 1, 2);

    return (
        <MockHostCard host={host.host}>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="absolute -top-[22%] -left-[22%] w-[52%] h-[52%] bg-transparent border-0 p-0 cursor-pointer z-20"
                aria-label={`${n} attachments — open pile`}
            >
                <div className="relative w-full h-full">
                    {Array.from({ length: layers }).map((_, i) => (
                        <div
                            key={i}
                            className="absolute inset-0 rounded-sm bg-neutral-700 ring-1 ring-black/50 shadow-md"
                            style={{
                                transform: `translate(${(i + 1) * 4}px, ${(i + 1) * 4}px)`,
                                zIndex: i,
                            }}
                        />
                    ))}
                    <div className="absolute inset-0 z-10 rounded-sm overflow-hidden ring-1 ring-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
                        <CardImage card={top.card} />
                    </div>
                    <div className="absolute -top-1.5 -right-1.5 z-20 pointer-events-none rounded-full bg-black/85 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-1 ring-white/30 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        ×{n}
                    </div>
                    {/* kind legend — one dot per satellite, capped */}
                    <div className="absolute -bottom-2 left-0 z-20 flex gap-0.5">
                        {host.attachments.slice(0, 6).map((att) => (
                            <span
                                key={att.card.id}
                                className={`w-1.5 h-1.5 rounded-full ring-1 ring-black/60 ${DOT[att.kind]}`}
                            />
                        ))}
                    </div>
                </div>
            </button>
            <AttachmentPileDialog
                title={`Attached to ${host.label.split(" —")[0]}`}
                attachments={host.attachments}
                open={open}
                onOpenChange={setOpen}
            />
        </MockHostCard>
    );
}
