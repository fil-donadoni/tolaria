// PROTOTYPE — throwaway. Drafting: your latest picks as art thumbs.
import { getArtCropImageUrl } from "~/lib/images";
import ManaPips from "./mana-pips";
import TileFrame from "./tile-frame";
import type { MockSeat } from "./event-mock";

export default function PicksTile({
    viewer,
    className,
}: {
    viewer: MockSeat;
    className?: string;
}) {
    const recent = viewer.picks.slice(0, viewer.picked).slice(-6).reverse();
    return (
        <TileFrame
            title="Your picks"
            right={
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    leaning <ManaPips colors={["U", "B"]} size="xs" />
                </span>
            }
            className={className}
        >
            <div className="grid grid-cols-3 gap-1.5">
                {recent.map((c, i) => (
                    <figure
                        key={`${c.id}-${i}`}
                        className="relative overflow-hidden rounded-sm border border-border-strong"
                        title={c.name}
                    >
                        <img
                            src={getArtCropImageUrl(c.id)}
                            alt={c.name}
                            className="aspect-[4/3] w-full object-cover"
                            loading="lazy"
                        />
                        <figcaption className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 text-[9px] text-parchment">
                            {c.name}
                        </figcaption>
                    </figure>
                ))}
            </div>
            <p className="text-xs text-text-muted">
                <b className="text-parchment">{viewer.picked}</b> of 45 picked
            </p>
        </TileFrame>
    );
}
