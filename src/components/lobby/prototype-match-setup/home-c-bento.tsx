// PROTOTYPE — throwaway. Home C "Bento": one dense art grid — Last Match
// wide first, Constructed and Limited equal beside it, Your Tables as small art tiles
// filling the grid; Decks below as full-width shelves.
import ProtoArtCard from "./proto-art-card";
import ProtoDecksSection from "./proto-decks-section";
import { PLAY_ART, tableArt, type ProtoHomeProps } from "./proto-home-data";

export const HOME_C_NAME = "Bento grid";

export default function HomeCBento(p: ProtoHomeProps) {
    const lm = p.data.lastMatch;
    return (
        <div className="flex flex-col gap-6">
            <div className="grid auto-rows-[9rem] grid-cols-2 gap-3 md:grid-cols-4">
                {lm ? (
                    <ProtoArtCard art={{ cards: [lm.myArt, lm.oppArt] }} chip={`Last Match · ${lm.summary}`} title={`${lm.myName} vs ${lm.oppName}`} titleClass="text-2xl md:text-4xl" className="col-span-2 row-span-2" onClick={p.onReplay}>
                        <span className="mt-2 flex items-center gap-3 text-sm font-semibold text-parchment">
                            <span className="rounded-sm bg-parchment px-3 py-1.5 text-surface-base">Play again →</span>
                            <span role="button" onClick={(e) => { e.stopPropagation(); p.onEditLast(); }} className="font-normal text-text-muted underline">change setup</span>
                        </span>
                    </ProtoArtCard>
                ) : null}
                <ProtoArtCard art={{ image: PLAY_ART.constructed }} chip="Play" title="Constructed" line="vs Bot · Solo · Human" onClick={p.onConstructed} className="md:row-span-2" titleClass="text-2xl md:text-3xl" />
                <ProtoArtCard art={{ image: PLAY_ART.limited }} chip="Play" title="Limited" line="Sealed · Draft events" onClick={p.onLimited} className="md:row-span-2" titleClass="text-2xl md:text-3xl" />
                {p.data.tables.map((t, i) => (
                    <ProtoArtCard key={t.id} art={tableArt(t, i)} chip={t.phase} title={t.name} titleClass="text-base" line={`Your table · ${t.kind}`} onClick={() => {}} />
                ))}
            </div>
            <ProtoDecksSection userDecks={p.data.userDecks} presetDecks={p.data.presetDecks} onOpen={p.onOpenDeck} onNew={p.onNewDeck} />
        </div>
    );
}
