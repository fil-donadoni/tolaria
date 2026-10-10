// PROTOTYPE — throwaway. The ONE next action per phase (the hero's content).
import { EVENT_META, passDirectionFor } from "./event-mock";
import type { EventProto } from "./use-event-proto";

export interface NextAction {
    eyebrow: string;
    title: string;
    line: string;
    cta: string;
    onCta: () => void;
    /** Small secondary text link under the CTA, if any. */
    aside?: { label: string; onClick: () => void };
    tone: "accent" | "success" | "muted";
}

export function nextActionFor(p: EventProto): NextAction {
    const humans = p.seats.filter((s) => s.kind === "human").length;
    const open = p.seats.filter((s) => s.kind === "empty").length;
    switch (p.phase) {
        case "waiting":
            return p.viewpoint === "creator"
                ? {
                      eyebrow: "Waiting for players",
                      title: `${humans} of ${EVENT_META.seatCount} seats taken`,
                      line: `Start whenever you like — bots take the ${open} open seats, for the draft and for the games.`,
                      cta: `Start now · ${open} bots fill in`,
                      onCta: () => p.setPhase("drafting"),
                      aside: {
                          label: "Copy invite link",
                          onClick: () => p.log("copy link"),
                      },
                      tone: "accent",
                  }
                : {
                      eyebrow: "Open event",
                      title: `${open} open seats`,
                      line: `${humans} players are waiting. Take a seat — the creator starts when ready.`,
                      cta: "Join this event",
                      onCta: () => p.setViewpoint("creator"),
                      tone: "accent",
                  };
        case "drafting": {
            const dir = passDirectionFor(EVENT_META.draftPack);
            return {
                eyebrow: `Pack ${EVENT_META.draftPack} · Pick ${EVENT_META.draftPick} · passing ${dir}`,
                title: "2 packs waiting for you",
                line: `0:${EVENT_META.pickSecondsLeft} left on this pick. Morgana is holding 3 packs.`,
                cta: "Enter the Draft Room",
                onCta: () => p.log("enter draft room"),
                tone: "accent",
            };
        }
        case "building": {
            const decks = p.seats.filter((s) => s.hasDeck).length;
            return {
                eyebrow: "Deckbuilding",
                title: "Build your deck",
                line: `${EVENT_META.poolSize}-card pool, 40-card minimum. ${decks}/${EVENT_META.seatCount} decks in — round 1 starts when every seat is ready.`,
                cta: "Open deck builder",
                onCta: () => p.setPhase("playing"),
                tone: "accent",
            };
        }
        case "playing":
            return {
                eyebrow: `Round ${EVENT_META.currentRound} of ${EVENT_META.rounds} · ${EVENT_META.gamesFormat}`,
                title: "You play Morgana",
                line: "Human · B/R · 1-0 in the event. Round closes in 42 min.",
                cta: "Play match",
                onCta: () => p.log("play match"),
                tone: "success",
            };
        case "finished":
            return {
                eyebrow: "Event finished",
                title: "You finished 2nd · 2-1",
                line: "Morgana won the table 3-0. Every deck and pick order is now public.",
                cta: "Review the table",
                onCta: () => p.setTab("review"),
                tone: "muted",
            };
    }
}
