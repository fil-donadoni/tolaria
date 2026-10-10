// PROTOTYPE — throwaway. The Pack Source the pool came from, as a chip with
// its Feature Card art — sits beside the deck name it seeded.
import { getArtCropImageUrl } from "~/lib/images";
import { PACK_SOURCE } from "./builder-data";

export default function PackSourceChip() {
    return (
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-full border border-[var(--hairline-strong)] bg-surface-base/70 pr-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-parchment">
            <img
                src={getArtCropImageUrl(PACK_SOURCE.featureCardId)}
                alt=""
                className="h-full w-9 object-cover"
            />
            {PACK_SOURCE.name}
        </span>
    );
}
