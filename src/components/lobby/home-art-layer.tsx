// The art behind one lobby-home tile (issue #5344): a local lobby frame, one
// deck's featured art, or two decks' art clipped to either side of a white
// diagonal. Decoration only — the caller wraps it `aria-hidden`.
import type { HomeArt } from "~/lib/lobbyHome";
import FeaturedDeckArt from "./featured-deck-art";

export default function HomeArtLayer({ art }: { art: HomeArt }) {
    if ("image" in art) {
        return (
            <img
                src={art.image}
                alt=""
                draggable={false}
                className="h-full w-full select-none object-cover object-[50%_30%] opacity-85 transition group-hover:opacity-100"
            />
        );
    }
    if ("deck" in art) {
        return (
            <FeaturedDeckArt
                featuredCardId={art.deck}
                className="h-full w-full"
            />
        );
    }
    return (
        <>
            <FeaturedDeckArt
                featuredCardId={art.split[0]}
                className="absolute inset-0 h-full w-full [clip-path:polygon(0_0,58%_0,42%_100%,0_100%)]"
            />
            <FeaturedDeckArt
                featuredCardId={art.split[1]}
                className="absolute inset-0 h-full w-full [clip-path:polygon(58%_0,100%_0,100%_100%,42%_100%)]"
            />
            <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
            >
                <line
                    x1="58"
                    y1="0"
                    x2="42"
                    y2="100"
                    stroke="white"
                    strokeWidth="3"
                    vectorEffect="non-scaling-stroke"
                />
            </svg>
        </>
    );
}
