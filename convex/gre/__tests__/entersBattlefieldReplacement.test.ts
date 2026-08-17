// Enters-the-battlefield replacement effects (CR 614, issue #1148).
//
// CR 614.1a — "Some replacement effects modify how an event affects an
// object ... 'If a nontoken creature would enter the battlefield and it
// wasn't cast, exile it instead' redirects a zone-change event". No shipped
// `ReplacementEventKind` covered a permanent entering the battlefield at
// all before this change — this suite exercises the new
// `"enters-battlefield"` kind end to end at every named chokepoint
// (`gre-development.md` / issue #1148): the shared non-cast helper
// (`stageReanimatedOnBattlefield`, behind `returnToBattlefield` and
// `putFromLibraryOntoBattlefield`), cast-resolution
// (`finalizeSpellResolution`), and token creation (`createToken`) — using a
// synthetic redirector shaped like Containment Priest so the FRAMEWORK is
// proven independently of the shipped card (Containment Priest's own
// behavior is covered in `cards/sets/c14/__tests__/white.test.ts`).
import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardInstanceState } from "../state";
import {
    buildSpellContext,
    flushPendingEvents,
    resolveTopOfStack,
} from "../state";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { makePlayer, makeState, pushSpell } from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";

// "If a nontoken creature would enter and it wasn't cast, exile it instead"
// (Containment Priest's shape) — global, not controller-scoped.
const REDIRECTOR_ID = "test-enters-battlefield-redirector";
// A plain nontoken creature to reanimate/cast/put onto the battlefield.
const VICTIM_ID = "test-enters-battlefield-victim";

const redirectorDef: CardDefinition = {
    id: REDIRECTOR_ID,
    name: "Test Enters-Battlefield Redirector",
    rarity: "common",
    types: ["Artifact"],
    replacementEffects: [
        {
            id: "test-exile-uncast-nontoken-creature",
            oracleText:
                "If a nontoken creature would enter and it wasn't cast, exile it instead.",
            eventKind: "enters-battlefield",
            appliesTo: (event) => {
                if (event.kind !== "enters-battlefield") return false;
                if (event.isToken || event.wasCast) return false;
                return event.types.includes("Creature");
            },
            replace: (event) => {
                if (event.kind !== "enters-battlefield") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, destination: "exile" },
                };
            },
        },
    ],
};

const victimDef: CardDefinition = {
    id: VICTIM_ID,
    name: "Test Enters-Battlefield Victim",
    rarity: "common",
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

beforeAll(() => {
    registerTokenDefinition(redirectorDef);
    registerTokenDefinition(victimDef);
});

function redirector(id: string, controllerId: string): CardInstanceState {
    return {
        id,
        card: { id: REDIRECTOR_ID },
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
    };
}

function victimInGraveyard(id: string, ownerId: string): CardInstanceState {
    return {
        id,
        card: { id: VICTIM_ID },
        types: ["Creature"],
        subtypes: ["Bear"],
        power: 2,
        toughness: 2,
        staticAbilities: [],
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
        isTapped: false,
    };
}

function victimInLibrary(id: string, ownerId: string): CardInstanceState {
    return { ...victimInGraveyard(id, ownerId), zone: "library" };
}

describe("enters-battlefield replacement (CR 614, issue #1148)", () => {
    it("redirects a reanimated (graveyard -> battlefield) nontoken creature to exile via the shared stageReanimatedOnBattlefield chokepoint", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [victimInGraveyard("victim", "p1")],
                    battlefield: [redirector("src1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, REDIRECTOR_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        const entered = ctx.returnToBattlefield("p1", "victim", "graveyard");
        // The redirect means the creature never entered the battlefield, so the
        // primitive reports false: callers gate "if you do" riders and
        // just-entered snapshots on this, and a true here made `moveZone`'s
        // `bind` read a permanent sitting in exile (Sneak Attack crash).
        expect(entered).toBe(false);
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "victim")).toBe(false);
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile.some((c) => c.id === "victim")).toBe(true);
        const events = flushPendingEvents(state);
        expect(events.some((e) => e.type === "PERMANENT_ENTERED")).toBe(false);
    });

    it("redirects a library-tutored-to-battlefield nontoken creature to exile (putFromLibraryOntoBattlefield)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [victimInLibrary("victim", "p1")],
                    battlefield: [redirector("src1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, REDIRECTOR_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        const entered = ctx.putFromLibraryOntoBattlefield("p1", "victim");
        // Redirected to exile — never entered, so the primitive reports false.
        expect(entered).toBe(false);
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "victim")).toBe(false);
        expect(p1.library).toHaveLength(0);
        expect(p1.exile.some((c) => c.id === "victim")).toBe(true);
    });

    it("does NOT redirect a normally CAST creature (finalizeSpellResolution, wasCast: true)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [redirector("src1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, VICTIM_ID, "p1");
        resolveTopOfStack(state);
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.card.id === VICTIM_ID)).toBe(true);
        expect(p1.exile).toHaveLength(0);
    });

    it("does NOT redirect a token creation (createToken, isToken exemption)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [redirector("src1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, REDIRECTOR_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        const ids = ctx.createToken(
            {
                name: "Test Bear Token",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            },
            "p1"
        );
        expect(ids).toHaveLength(1);
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === ids[0])).toBe(true);
        expect(p1.exile).toHaveLength(0);
    });

    it("wire format: an exile-redirected reanimated creature survives projectPublicState for both viewers", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [victimInGraveyard("victim", "p1")],
                    battlefield: [redirector("src1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, REDIRECTOR_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.returnToBattlefield("p1", "victim", "graveyard");
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const p1Slim = projected.players.find((p) => p.id === "p1")!;
            expect(p1Slim.battlefield.some((c) => c.id === "victim")).toBe(
                false
            );
            expect(p1Slim.exile.some((c) => c.id === "victim")).toBe(true);
        }
    });
});

// ADR 0100 D1 — the CR 614 entry chokepoint is what makes "one place to
// forget" true for the spell / effect / token census rows: an entry path that
// skipped `enterBattlefieldDestinationFor` would miss the Containment Priest
// redirect above AND the as-enters choice point (#2492). Every test in this
// file exercises the redirect BEHAVIOUR at one of the three sites; none of
// them notices a FOURTH site being added, because a fourth site simply is not
// covered by any of them. This is the structural assertion that does.
describe("the CR 614 entry chokepoint has exactly three callers (ADR 0100 D1)", () => {
    const CALLERS = [
        "convex/gre/state.ts:finalizeSpellResolution (census row A — permanent spell)",
        "convex/gre/state.ts:stageReanimatedOnBattlefield (census row B — non-cast entry)",
        "convex/gre/state.ts:createTokenPermanents (census row C — token creation)",
    ];

    function sourceFiles(dir: string): string[] {
        const out: string[] = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (
                    entry.name === "node_modules" ||
                    entry.name === "_generated"
                ) {
                    continue;
                }
                out.push(...sourceFiles(full));
            } else if (
                entry.name.endsWith(".ts") &&
                !entry.name.endsWith(".test.ts")
            ) {
                out.push(full);
            }
        }
        return out;
    }

    it("no fourth entry path can be added silently", () => {
        const root = fileURLToPath(new URL("../../..", import.meta.url));
        const callSites: string[] = [];
        for (const dir of ["convex", "src"]) {
            for (const file of sourceFiles(join(root, dir))) {
                const text = readFileSync(file, "utf8");
                text.split("\n").forEach((line, i) => {
                    if (!line.includes("enterBattlefieldDestinationFor("))
                        return;
                    // The definition itself and the `export { … } from` /
                    // `import { … }` re-export lines are not call sites.
                    if (line.includes("export function")) return;
                    callSites.push(
                        `${file.slice(root.length)}:${i + 1} ${line.trim()}`
                    );
                });
            }
        }
        expect(
            callSites,
            `Expected exactly the three ADR 0100 census rows:\n${CALLERS.join("\n")}\n` +
                "A new call site means a FOURTH entry path — either fold it into an " +
                "existing row or amend ADR 0100's census before changing this number."
        ).toHaveLength(3);
        expect(callSites.every((s) => s.includes("convex/gre/state.ts:"))).toBe(
            true
        );
    });
});
