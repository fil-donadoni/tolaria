// PROTOTYPE — Variant B: BOTTOM TRAY SHELF.
// The host art stays fully unobscured. Satellites dock as a horizontal strip of
// slim vertical slivers along the host's bottom edge — each sliver shows the
// left band of its card art behind a kind-coloured spine (violet = aura,
// amber = exile). A count chip + click open the shared pile dialog. Different
// hierarchy from A: attachments never cover the host, they sit on a "shelf".
import { useState } from "react";
import type { MockHost } from "./mock-attachment-data";
import MockHostCard from "./mock-host-card";
import AttachmentPileDialog from "./attachment-pile-dialog";
import CardImage from "../cards/card-image";

const SPINE: Record<string, string> = {
    aura: "bg-violet-400",
    exile: "bg-amber-400",
};

export default function AttachmentClusterVariantB({
    host,
}: {
    host: MockHost;
}) {
    const [open, setOpen] = useState(false);
    const n = host.attachments.length;

    return (
        <MockHostCard host={host.host}>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-[112%] bg-transparent border-0 p-0 cursor-pointer z-20"
                aria-label={`${n} attachments — open pile`}
            >
                <div className="flex items-end justify-center gap-[3px] rounded-sm bg-black/70 px-1.5 py-1 ring-1 ring-white/15 shadow-[0_4px_10px_rgba(0,0,0,0.6)]">
                    {host.attachments.map((att) => (
                        <div
                            key={att.card.id}
                            className="relative w-[15px] h-[42px] rounded-[2px] overflow-hidden ring-1 ring-black/50"
                        >
                            {/* Left band of the card art — a recognizable sliver. */}
                            <div className="absolute inset-0 w-[46px]">
                                <CardImage card={att.card} />
                            </div>
                            <div
                                className={`absolute inset-y-0 left-0 w-[3px] ${SPINE[att.kind]}`}
                            />
                        </div>
                    ))}
                    <div className="ml-1 self-center rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                        {n}
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
