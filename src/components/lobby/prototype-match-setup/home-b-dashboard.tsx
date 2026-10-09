// PROTOTYPE — throwaway. Home B "Dashboard": main column = Play tiles +
// Decks grid; side rail = Last Match card + Your Tables list with thumbs.
import FeaturedDeckArt from "../featured-deck-art";
import ProtoArtCard from "./proto-art-card";
import ProtoDecksSection from "./proto-decks-section";
import { PLAY_ART, tableArt, type ProtoHomeProps } from "./proto-home-data";

export const HOME_B_NAME = "Dashboard: main + side rail";

const H = ({ children }: { children: string }) => (
    <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
        {children}
    </h2>
);

export default function HomeBDashboard(p: ProtoHomeProps) {
    const lm = p.data.lastMatch;
    return (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col gap-6">
                <section className="flex flex-col gap-2">
                    <H>Play</H>
                    <div className="grid grid-cols-2 gap-3">
                        <ProtoArtCard
                            art={{ image: PLAY_ART.constructed }}
                            chip="vs Bot · Solo · Human"
                            title="Constructed"
                            line="Bring a deck"
                            onClick={p.onConstructed}
                            className="h-52"
                            titleClass="text-3xl"
                        />
                        <ProtoArtCard
                            art={{ image: PLAY_ART.limited }}
                            chip="Sealed · Draft"
                            title="Limited"
                            line="Join or create an event"
                            onClick={p.onLimited}
                            className="h-52"
                            titleClass="text-3xl"
                        />
                    </div>
                </section>
                <ProtoDecksSection
                    userDecks={p.data.userDecks}
                    presetDecks={p.data.presetDecks}
                    onOpen={p.onOpenDeck}
                    onNew={p.onNewDeck}
                    layout="grid"
                />
            </div>
            <aside className="flex flex-col gap-6">
                {lm && (
                    <section className="flex flex-col gap-2">
                        <H>Last Match</H>
                        <div className="overflow-hidden rounded-[var(--panel-radius)] border border-border-strong bg-surface/80">
                            <div className="flex h-24">
                                <FeaturedDeckArt
                                    featuredCardId={lm.myArt}
                                    className="h-full flex-1"
                                />
                                <FeaturedDeckArt
                                    featuredCardId={lm.oppArt}
                                    className="h-full flex-1"
                                />
                            </div>
                            <div className="flex flex-col gap-2 p-3">
                                <span className="text-sm text-parchment">
                                    {lm.myName} vs {lm.oppName}
                                </span>
                                <span className="text-xs text-text-muted">
                                    {lm.summary}
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={p.onReplay}
                                        className="flex-1 rounded-sm bg-parchment px-3 py-1.5 text-sm font-semibold text-surface-base"
                                    >
                                        Play again →
                                    </button>
                                    <button
                                        type="button"
                                        onClick={p.onEditLast}
                                        className="rounded-sm border border-border-strong px-3 py-1.5 text-sm text-text"
                                    >
                                        Change
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                )}
                <section className="flex flex-col gap-2">
                    <H>Your Tables</H>
                    {p.data.tables.length === 0 && (
                        <p className="text-xs text-text-disabled">
                            You're not seated anywhere.
                        </p>
                    )}
                    {p.data.tables.map((t, i) => {
                        const art = tableArt(t, i);
                        return (
                            <button
                                key={t.id}
                                type="button"
                                className="flex items-center gap-3 overflow-hidden rounded-sm border border-border-strong bg-surface/70 text-left hover:border-accent/60"
                            >
                                {"image" in art ? (
                                    <img
                                        src={art.image}
                                        alt=""
                                        className="h-12 w-16 object-cover"
                                    />
                                ) : (
                                    <FeaturedDeckArt
                                        featuredCardId={art.cards[0]}
                                        className="h-12 w-16"
                                    />
                                )}
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm text-parchment">
                                        {t.name}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wide text-text-muted">
                                        {t.kind} · {t.phase}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </section>
            </aside>
        </div>
    );
}
