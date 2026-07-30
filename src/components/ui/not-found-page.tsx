// Shared full-page "404 — Page not found", wired as the router's
// `defaultNotFoundComponent` (`src/router.tsx`) AND rendered by `/draft-lab`
// for a non-admin: an admin-only developer surface should not confirm its own
// existence to someone who may not open it, so the route renders THIS rather
// than an explanatory "you're not an admin" notice. Being the same page an
// unknown path produces is exactly what makes the two indistinguishable.
//
// The page shows a random card whose name contains "Lost in" (see
// `src/lib/lostInCards.ts` for why that list is a checked-in constant and not
// a live Scryfall query). Picked once per mount, not per render, so a re-render
// doesn't reshuffle the artwork under the user.
import { useState } from "react";
import AmbientPageGround from "@/components/ui/ambient-page-ground";
import { getImageFallbackUrl, getImageUrl } from "@/lib/images";
import { pickLostInCard } from "@/lib/lostInCards";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function NotFoundPage() {
    const [card] = useState(pickLostInCard);
    // Also the title a non-admin gets on an admin path — same page, same tab
    // title, no confirmation that the surface exists.
    useDocumentTitle("Page Not Found");
    // Scryfall's WebP renditions can be missing on some printings; the legacy
    // `normal` JPG always exists. Same one-step fallback `CardImage` uses.
    const [useJpgFallback, setUseJpgFallback] = useState(false);

    return (
        <div className="relative flex flex-1 flex-col bg-surface-base text-text">
            <AmbientPageGround />
            <div className="relative z-10 mx-auto flex min-h-[60dvh] max-w-6xl flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center sm:px-8">
                <img
                    src={
                        useJpgFallback
                            ? getImageFallbackUrl(card.id)
                            : getImageUrl(card.id)
                    }
                    alt={card.name}
                    width={244}
                    height={340}
                    draggable={false}
                    onError={() => setUseJpgFallback(true)}
                    className="w-[244px] max-w-full rounded-[4.75%/3.5%] shadow-lg"
                />
                <div>
                    <p className="text-label">404</p>
                    <h1 className="heading-panel mt-2 text-3xl">
                        Page not found
                    </h1>
                    <span className="panel-rule mx-auto mt-4 block h-px w-full max-w-sm" />
                    <p className="mt-4 max-w-md text-sm text-text-muted">
                        This page doesn't exist, or it moved.
                    </p>
                    {/* A plain anchor, not a router `Link`: this page renders
                        from a route component AND from the router's not-found
                        slot, and "/" is the app root — the one path a full load
                        can never miss on a static host lacking an SPA fallback.
                        It also keeps the component renderable in a unit test
                        with no router context. */}
                    <a
                        href="/"
                        className="mt-6 inline-block text-sm text-accent underline underline-offset-4"
                    >
                        Back to the lobby
                    </a>
                </div>
            </div>
        </div>
    );
}
