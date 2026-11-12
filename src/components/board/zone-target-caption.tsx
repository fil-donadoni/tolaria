import { Crosshair } from "lucide-react";
import type { StackItem } from "~/types/game";
import TargetThumb from "./target-thumb";

/** Width of a targeting source's thumbnail under a zone card (px) — large
 *  enough to recognise the card (issue #9326). */
const SOURCE_THUMB_W = 40;

/** Caption of a TARGETED card in a zone viewer (issue #9326): its position
 *  "#N" — the number its stack row's target line names — a crosshair, and a
 *  thumbnail of EACH stack object targeting it with that object's stack row
 *  number. */
export default function ZoneTargetCaption({
    position,
    sources,
}: {
    position: number;
    sources: ReadonlyArray<{ item: StackItem; stackNumber: number }>;
}) {
    return (
        <span
            data-zone-target-caption
            className="inline-flex items-start gap-1 text-text"
        >
            <span className="font-semibold">#{position}</span>
            <Crosshair
                aria-hidden
                className="size-[10px] shrink-0 text-accent-strong"
            />
            {sources.map(({ item, stackNumber }) => (
                <span
                    key={item.id}
                    data-zone-target-source={item.id}
                    className="inline-flex flex-col items-center gap-0.5"
                >
                    <TargetThumb card={item} width={SOURCE_THUMB_W} />
                    <span className="text-[9px] text-text-muted">
                        #{stackNumber}
                    </span>
                </span>
            ))}
        </span>
    );
}
