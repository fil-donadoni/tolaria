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
            <div className="grid grid-cols-2 gap-3 md:auto-rows-[9rem] md:grid-cols-4">
                {lm ? (
                    <ProtoArtCard art={{ cards: [lm.myArt, lm.oppArt] }} title={`${lm.myName} vs ${lm.oppName}`} meta={`Last Match · ${lm.summary}`} titleClass="text-2xl md:text-4xl" className="col-span-2 h-[240px] md:row-span-2 md:h-auto" onClick={p.onReplay}>
                        <span className="mt-2 flex w-full items-center justify-between gap-3">
                            <span className="rounded-sm bg-parchment px-3 py-1.5 text-sm font-semibold text-surface-base">Play again →</span>
                            <span role="button" onClick={(e) => { e.stopPropagation(); p.onEditLast(); }} className="text-sm text-text-muted underline">change setup</span>
                        </span>
                    </ProtoArtCard>
                ) : null}
                <ProtoArtCard art={{ image: PLAY_ART.constructed }} chip="Play" title="Constructed" line="vs Bot · Solo · Human" onClick={p.onConstructed} className="h-36 md:row-span-2 md:h-auto" titleClass="text-2xl md:text-3xl" />
                <ProtoArtCard art={{ image: PLAY_ART.limited }} chip="Play" title="Limited" line="Sealed · Draft events" onClick={p.onLimited} className="h-36 md:row-span-2 md:h-auto" titleClass="text-2xl md:text-3xl" />
                {p.data.tables.map((t, i) => (
                    <ProtoArtCard key={t.id} art={tableArt(t, i)} chip={t.phase} title={t.name} titleClass="text-base" line={`Your table · ${t.kind}`} onClick={() => {}} className="h-36 md:h-auto" />
                ))}
            </div>
            <ProtoDecksSection userDecks={p.data.userDecks} presetDecks={p.data.presetDecks} onOpen={p.onOpenDeck} onNew={p.onNewDeck} />
        </div>
    );
}
