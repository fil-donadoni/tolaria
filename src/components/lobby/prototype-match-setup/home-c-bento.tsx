// PROTOTYPE — throwaway. Home C "Bento": one dense art grid — Last Match
// wide first, Constructed and Limited equal beside it;
// Your Tables its own titled section (capped, Show all); Decks below as
// full-width shelves.
import { useState } from "react";
import ProtoArtCard from "./proto-art-card";
import ProtoDecksSection from "./proto-decks-section";
import { PLAY_ART, tableArt, type ProtoHomeProps } from "./proto-home-data";

export const HOME_C_NAME = "Bento grid";

export default function HomeCBento(p: ProtoHomeProps) {
    const lm = p.data.lastMatch;
    const [allTables, setAllTables] = useState(false);
    const TABLES_CAP = 4;
    const tables = allTables ? p.data.tables : p.data.tables.slice(0, TABLES_CAP);
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
            </div>
            <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                        Your Tables · {p.data.tables.length}
                    </h2>
                    {p.data.tables.length > TABLES_CAP && (
                        <button type="button" onClick={() => setAllTables(!allTables)} className="text-xs text-text-muted underline">
                            {allTables ? "Show less" : `Show all (${p.data.tables.length})`}
                        </button>
                    )}
                </div>
                {tables.length === 0 ? (
                    <p className="text-xs text-text-disabled">You're not seated anywhere.</p>
                ) : (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {tables.map((t, i) => (
                            <ProtoArtCard key={t.id} art={tableArt(t, i)} chip={t.phase} title={t.name} titleClass="text-base" line={t.kind} onClick={() => {}} className="h-36" />
                        ))}
                    </div>
                )}
            </section>
            <ProtoDecksSection userDecks={p.data.userDecks} presetDecks={p.data.presetDecks} onOpen={p.onOpenDeck} onNew={p.onNewDeck} />
        </div>
    );
}
