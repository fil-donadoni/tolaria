// PROTOTYPE — Variant A: CORNER PEEK STACK, behind the host.
// Compact: the FRONT satellite sits in the host's top-left corner overhang; the
// rest are stacked a few % further up-left so only a thin sliver of each peeks
// out behind it — a one-glance "there are N here" cue, no wide spread. Click
// (front card or ×N badge) opens the full pile dialog.
import { useState } from "react";
import type { MockHost } from "./mock-attachment-data";
import MockHostCard from "./mock-host-card";
import AttachmentPileDialog from "./attachment-pile-dialog";
import CardImage from "../cards/card-image";

const KIND_RING: Record<string, string> = {
    aura: "ring-violet-400/80",
    exile: "ring-amber-400/80",
};

// Thin sliver per extra card; caps so a big cluster never sprawls.
const STEP = 3;
const MAX_PEEK = 5;

export default function AttachmentClusterVariantA({
    host,
}: {
    host: MockHost;
}) {
    const [open, setOpen] = useState(false);
    const n = host.attachments.length;
    // Only a few slivers are worth showing; the badge carries the true count.
    const shown = host.attachments.slice(0, MAX_PEEK);

    const stack = (
        <button
            type="button"
            onClick={() => setOpen(true)}
            className="absolute inset-0 bg-transparent border-0 p-0 cursor-pointer"
            aria-label={`${n} attachments — open pile`}
        >
            {/* Paint back-to-front so the first card ends up on top. */}
            {[...shown].reverse().map((att, ri) => {
                const i = shown.length - 1 - ri; // 0 = front
                const out = 22 + i * STEP;
                return (
                    <div
                        key={att.card.id}
                        className="absolute w-[58%] h-[58%]"
                        style={{
                            top: `-${out}%`,
                            left: `-${out}%`,
                            // Below the host (z-10): the whole stack sits behind
                            // the card, only the corner overhang shows.
                            zIndex: 9 - i,
                        }}
                    >
                        <div
                            className={`w-full h-full rounded-sm overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.6)] ring-1 ${KIND_RING[att.kind]}`}
                        >
                            <CardImage card={att.card} />
                        </div>
                    </div>
                );
            })}
        </button>
    );

    return (
        <MockHostCard host={host.host} behind={stack}>
            {/* ×N badge in FRONT of the host so the count always reads. */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="absolute -top-2 -left-2 z-20 rounded-full bg-black/85 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-1 ring-white/30 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] cursor-pointer"
                aria-label={`${n} attachments — open pile`}
            >
                ×{n}
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
