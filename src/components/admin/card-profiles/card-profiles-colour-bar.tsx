import type { ColourSignature } from "@convex/limited/archetypeCatalogueCore";

const SEGMENT_CLASS: Record<keyof ColourSignature, string> = {
    W: "bg-mana-white",
    U: "bg-mana-blue",
    B: "bg-mana-black",
    R: "bg-mana-red",
    G: "bg-mana-green",
};

const COLOUR_NAME: Record<keyof ColourSignature, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};

/** A catalogue row's colour signature as a one-line bar, one segment per
 *  colour sized by its share of the row's tagged cards. Empty (a muted
 *  track) when no tagged card has a colour. */
export default function CardProfilesColourBar({
    signature,
}: {
    signature: ColourSignature;
}) {
    const present = (
        Object.keys(SEGMENT_CLASS) as (keyof ColourSignature)[]
    ).filter((colour) => signature[colour] > 0);
    const summary =
        present.length === 0
            ? "no colour"
            : present
                  .map(
                      (colour) =>
                          `${Math.round(signature[colour] * 100)}% ${COLOUR_NAME[colour]}`
                  )
                  .join(", ");
    return (
        <div
            role="img"
            aria-label={`Colour signature: ${summary}`}
            className="flex h-1 w-full overflow-hidden rounded-full bg-surface-elevated"
        >
            {present.map((colour) => (
                <span
                    key={colour}
                    className={SEGMENT_CLASS[colour]}
                    style={{ flexGrow: signature[colour] }}
                />
            ))}
        </div>
    );
}
