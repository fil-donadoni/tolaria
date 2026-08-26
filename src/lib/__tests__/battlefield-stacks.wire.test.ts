import { describe, it, expect } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { FACE_DOWN_CARD_ID } from "@convex/cards";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
} from "@convex/gre/state";
import type { CardInstance } from "~/types/game";
import { getCardImageDefId } from "~/lib/card-image-signature";
import { groupBattlefield, type PermanentGroup } from "../battlefield-stacks";

// ---------------------------------------------------------------------------
// Wire-format test (PRD #621, issue #622 — mandatory). The projection reshapes
// exactly the fields the identity key and altered predicate read (slim
// `card: { id }`, stripped fat fields). Grouping over `projectPublicState`
// output MUST equal grouping over the fat state. Prior art:
// src/types/__tests__/projection-contract.test.ts.
// ---------------------------------------------------------------------------

let seq = 0;
function makeCard(
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id: `inst-${seq++}`,
        card: { id: "def-bear", name: "Grizzly Bears", types: ["Creature"] },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        types: ["Creature"],
        subtypes: ["Bear"],
        staticAbilities: [],
        isTapped: false,
        ...overrides,
    } as CardInstanceState;
}

function makePlayer(id: string, battlefield: CardInstanceState[]): PlayerState {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function makeState(battlefield: CardInstanceState[]): GameState {
    return {
        players: [makePlayer("p1", battlefield), makePlayer("p2", [])],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: 0,
        rngCounter: 0,
    };
}

function attachmentsByHost(
    perms: ReadonlyArray<{ id: string; attachedTo?: string }>
): Map<string, { id: string; attachedTo?: string }[]> {
    const map = new Map<string, { id: string; attachedTo?: string }[]>();
    const ids = new Set(perms.map((p) => p.id));
    for (const p of perms) {
        if (!p.attachedTo || !ids.has(p.attachedTo)) continue;
        const bucket = map.get(p.attachedTo);
        if (bucket) bucket.push(p);
        else map.set(p.attachedTo, [p]);
    }
    return map;
}

/** Reduce a grouping to a comparable shape (keys + member ids + isStack). */
function shape(groups: PermanentGroup[]) {
    return groups.map((g) => ({
        key: g.key,
        isStack: g.isStack,
        members: g.members.map((m) => m.id),
    }));
}

describe("groupBattlefield survives the wire projection", () => {
    it("projected grouping equals fat-state grouping (mixed board)", () => {
        const fat: CardInstanceState[] = [
            // Two clean bears (stack) — same tap state (tap now splits, QA);
            // manaCommitted still differs and stays excluded from the key.
            makeCard({ id: "bear1", isTapped: true }),
            makeCard({ id: "bear2", isTapped: true, manaCommitted: true }),
            // Sick bear — different key, own group.
            makeCard({ id: "bear-sick", isSummoningSick: true }),
            // Altered bears — each ejects to a singleton.
            makeCard({ id: "bear-ctr", counters: { "+1/+1": 1 } }),
            makeCard({ id: "bear-dmg", damageMarked: 1 }),
            makeCard({ id: "bear-color", colorOverride: ["U"] }),
            makeCard({ id: "bear-atk", isAttacking: true }),
            // A host with an aura attached → host ejects, aura folds out.
            makeCard({ id: "host" }),
            makeCard({
                id: "aura",
                card: { id: "def-aura", name: "Aura", types: ["Enchantment"] },
                types: ["Enchantment"],
                subtypes: ["Aura"],
                attachedTo: "host",
            } as Partial<CardInstanceState>),
        ];

        const state = makeState(fat);

        // Battlefield perms minus folded-in attachments (mirrors what the
        // component feeds groupBattlefield: hosts keep their slot, attachments
        // ride the host). Auras with a present host are NOT passed as perms.
        const fatHostMap = attachmentsByHost(fat);
        const fatPerms = fat.filter(
            (c) => !(c.attachedTo && fatHostMap.has(c.attachedTo))
        );
        const fatGroups = groupBattlefield(
            fatPerms as unknown as CardInstance[],
            fatHostMap as unknown as Map<string, CardInstance[]>
        );

        // Project to public state (viewer = p1, who owns the board).
        const projected = projectPublicState(state, 1, "p1");
        const slimBf = projected.players[0].battlefield as CardInstance[];
        const slimHostMap = attachmentsByHost(slimBf) as unknown as Map<
            string,
            CardInstance[]
        >;
        const slimPerms = slimBf.filter(
            (c) =>
                !(
                    c.attachedTo &&
                    (slimHostMap as Map<string, unknown>).has(c.attachedTo)
                )
        );
        const slimGroups = groupBattlefield(slimPerms, slimHostMap);

        // Grouping must be identical across the projection.
        expect(shape(slimGroups)).toEqual(shape(fatGroups));

        // Sanity: the two clean bears really did stack on both sides.
        const fatStack = fatGroups.find((g) => g.key === "bear1")!;
        expect(fatStack.isStack).toBe(true);
        expect(fatStack.members.map((m) => m.id)).toEqual(["bear1", "bear2"]);
        const slimStack = slimGroups.find((g) => g.key === "bear1")!;
        expect(slimStack.isStack).toBe(true);
    });

    // Issue #1735 review, finding 1 — regression proof. Before the fix,
    // `identityKey` grouped by raw `card.card.id`, which is the CR 708.2
    // face-down sentinel for EVERY viewer including the controller (the
    // face-down fix's own point). Two DIFFERENT face-down permanents the
    // SAME controller controls therefore shared one identity key and
    // collapsed into a single fanned pile, rendering only the lead member's
    // real art — even though `getCardImageDefId`/`displayCardId` already
    // resolve each member's OWN real art via `knownCardId`. The controller
    // must see two separate permanents, each with its own art.
    it("does not collapse the controller's two DIFFERENT face-down permanents into one stack (#1735 review)", () => {
        const djinn: CardInstanceState = {
            id: "fd-1",
            card: {
                id: FACE_DOWN_CARD_ID,
                name: "Face-down creature",
                types: ["Creature"],
            },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
            faceDown: true,
            faceDownOf: "mahamoti-djinn",
        } as unknown as CardInstanceState;
        const dragon: CardInstanceState = {
            id: "fd-2",
            card: {
                id: FACE_DOWN_CARD_ID,
                name: "Face-down creature",
                types: ["Creature"],
            },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
            faceDown: true,
            faceDownOf: "shivan-dragon",
        } as unknown as CardInstanceState;

        const state = makeState([djinn, dragon]);

        // Viewer = p1, the controller of both face-down permanents — the
        // exact projection the battlefield tile itself renders from.
        const projected = projectPublicState(state, 1, "p1");
        const slimBf = projected.players[0].battlefield as CardInstance[];
        const groups = groupBattlefield(slimBf, new Map());

        // Two singletons, never one stack merging the two different cards.
        expect(shape(groups)).toEqual([
            { key: "fd-1", isStack: false, members: ["fd-1"] },
            { key: "fd-2", isStack: false, members: ["fd-2"] },
        ]);

        // And each member's OWN art still resolves to its own real card —
        // the exact regression the reviewer's probe caught (post-fix,
        // pre-this-test: one stack, one art id, for both members).
        const artIds = slimBf.map((c) => getCardImageDefId(c));
        expect(artIds).toEqual(["mahamoti-djinn", "shivan-dragon"]);
    });
});
