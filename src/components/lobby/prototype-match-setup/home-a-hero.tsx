// PROTOTYPE — throwaway. Home A "Hero": Last Match is the hero banner (my
// deck's art vs theirs, Play again); Play tiles below; Your Tables as a row
// of art cards; Decks as shelves.
import ProtoArtCard from "./proto-art-card";
import ProtoDecksSection from "./proto-decks-section";
import { PLAY_ART, tableArt, type ProtoHomeProps } from "./proto-home-data";

export const HOME_A_NAME = "Hero: Last Match on top";

const H = ({ children }: { children: string }) => (
    <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
        {children}
    </h2>
);

export default function HomeAHero(p: ProtoHomeProps) {
    const lm = p.data.lastMatch;
    return (
        <div className="flex flex-col gap-6">
            {lm && (
                <section className="flex flex-col gap-2">
                    <H>Last Match</H>
                    <ProtoArtCard
                        art={{ cards: [lm.myArt, lm.oppArt] }}
                        chip={lm.summary}
                        title={`${lm.myName} vs ${lm.oppName}`}
                        titleClass="text-4xl"
                        className="h-64"
                    >
                        <div className="mt-2 flex gap-2">
                            <button type="button" onClick={p.onReplay} className="rounded-sm bg-parchment px-4 py-2 text-sm font-semibold text-surface-base">
                                Play again →
                            </button>
                            <button type="button" onClick={p.onEditLast} className="rounded-sm border border-[var(--hairline-strong)] bg-surface-base/60 px-3 py-2 text-sm text-parchment">
                                Change setup
                            </button>
                        </div>
                    </ProtoArtCard>
                </section>
            )}
            <section className="flex flex-col gap-2">
                <H>Play</H>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ProtoArtCard art={{ image: PLAY_ART.constructed }} chip="vs Bot · Solo · Human" title="Constructed" line="Bring a deck" onClick={p.onConstructed} className="h-40" />
                    <ProtoArtCard art={{ image: PLAY_ART.limited }} chip="Sealed · Draft" title="Limited" line="Join or create an event" onClick={p.onLimited} className="h-40" />
                </div>
            </section>
            <section className="flex flex-col gap-2">
                <H>Your Tables</H>
                {p.data.tables.length === 0 ? (
                    <p className="text-xs text-text-disabled">You're not seated anywhere.</p>
                ) : (
                    <div className="flex gap-3 overflow-x-auto py-1">
                        {p.data.tables.map((t, i) => (
                            <ProtoArtCard key={t.id} art={tableArt(t, i)} chip={`${t.kind} · ${t.phase}`} title={t.name} titleClass="text-lg" className="h-32 w-60 shrink-0" onClick={() => {}} />
                        ))}
                    </div>
                )}
            </section>
            <ProtoDecksSection userDecks={p.data.userDecks} presetDecks={p.data.presetDecks} onOpen={p.onOpenDeck} onNew={p.onNewDeck} />
        </div>
    );
}
