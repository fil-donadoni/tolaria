import PrintedFaceImage from "~/components/cards/printed-face-image";
import { resolveCardImageFace, resolveCardImageId } from "~/lib/images";
import { cn } from "~/lib/utils";

/** A printed card face filling its slot's width (issue #9820), or a named
 *  placeholder when the card has no print. `pointer-events-none`: the tile
 *  around it owns every gesture, and the image never offers the browser's
 *  native drag or long-press image menu (issue #9814). */
export default function SideboardCardImage({
    cardId,
    name,
    className,
}: {
    cardId: string;
    name: string;
    className?: string;
}) {
    const imageId = resolveCardImageId(cardId);
    const slot = cn(
        "pointer-events-none block aspect-[488/680] w-full rounded-[4.5%] select-none",
        className
    );
    if (!imageId)
        return (
            <span
                className={cn(
                    slot,
                    "flex items-center justify-center bg-surface-elevated p-2 text-center text-xs text-parchment"
                )}
            >
                {name}
            </span>
        );
    return (
        <PrintedFaceImage
            imageId={imageId}
            face={resolveCardImageFace(cardId)}
            alt={name}
            className={cn(slot, "object-cover")}
        />
    );
}
