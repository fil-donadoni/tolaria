// PROTOTYPE — throwaway. Home C "Bento": one dense art grid — Constructed
// big, Limited and Last Match beside it, Your Tables as small art tiles
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
                <ProtoArtCard art={{ image: PLAY_ART.constructed }} chip="Play" title="Constructed" line="vs Bot · Solo · Human" onClick={p.onConstructed} className="col-span-2 row-span-2" titleClass="text-4xl" />
                <ProtoArtCard art={{ image: PLAY_ART.limited }} chip="Play" title="Limited" line="Sealed · Draft events" onClick={p.onLimited} className="col-span-2 md:col-span-1 md:row-span-2" titleClass="text-3xl" />
                {lm ? (
                    <ProtoArtCard art={{ cards: [lm.myArt, lm.oppArt] }} chip="Last Match" title={`${lm.myName} vs ${lm.oppName}`} line={lm.summary} titleClass="text-xl" className="col-span-2 md:col-span-1 md:row-span-2" onClick={p.onReplay}>
                        <span className="mt-1 text-xs font-semibold text-parchment">Play again → <span role="button" onClick={(e) => { e.stopPropagation(); p.onEditLast(); }} className="ml-2 font-normal text-text-muted underline">change</span></span>
                    </ProtoArtCard>
                ) : null}
                {p.data.tables.map((t, i) => (
                    <ProtoArtCard key={t.id} art={tableArt(t, i)} chip={`Your table · ${t.phase}`} title={t.name} titleClass="text-base" line={t.kind} onClick={() => {}} />
                ))}
            </div>
            <ProtoDecksSection userDecks={p.data.userDecks} presetDecks={p.data.presetDecks} onOpen={p.onOpenDeck} onNew={p.onNewDeck} />
        </div>
    );
}
