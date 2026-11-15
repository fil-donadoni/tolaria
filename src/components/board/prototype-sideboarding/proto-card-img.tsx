// PROTOTYPE — throwaway. A printed card face at any width (Scryfall grid art).
import { getImageUrl, resolveCardImageId } from "~/lib/images";
import { cn } from "~/lib/utils";

export default function ProtoCardImg({
    cardId,
    name,
    className,
}: {
    cardId: string;
    name: string;
    className?: string;
}) {
    const id = resolveCardImageId(cardId);
    return id ? (
        <img
            src={getImageUrl(id)}
            alt={name}
            draggable={false}
            className={cn(
                "aspect-[488/680] w-full rounded-[4.5%] object-cover select-none",
                className
            )}
        />
    ) : (
        <div
            className={cn(
                "flex aspect-[488/680] w-full items-center justify-center rounded-[4.5%] bg-surface-elevated p-2 text-center text-xs",
                className
            )}
        >
            {name}
        </div>
    );
}
