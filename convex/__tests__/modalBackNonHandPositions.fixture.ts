// Shared positions for the non-hand modal back-face cast suites (CR 712.11c,
// issue #7398): the engine suite (`modalBackFaceNonHandCast.test.ts`) and the
// Bot suite (`modalBackFaceNonHandCast.bot.test.ts`) run in different vitest
// projects and must drive the SAME boards.
import { hillGiant } from "../cards/sets/lea/red.cards";
import { forest, mountain, plains } from "../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards";
import type { CardInstanceState, GameState } from "../gre/state";
import {
    MODAL_INSTANT_BACK_PROBE_ID,
    modalFrontAbilityProbeId,
    type ModalFrontAbility,
} from "../gre/__tests__/fixtures/modalBackProbe.fixture";

const BOLAS_CITADEL = getCardByName("Bolas's Citadel")!.id;

export const own = (
    cardId: string,
    id: string,
    zone: CardInstanceState["zone"]
) => makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1", zone });

/** p1 holds priority in `active`'s main phase with a Mountain and two
 *  Plains (either face of either probe is affordable), a land in hand (the
 *  retrace discard) and a Forest in the graveyard (the escape exile). p2 has
 *  a Hill Giant to aim at. `place` puts the modal card `"mdfc"` where the
 *  licence under test reads it. */
export function position(
    cardId: string,
    place: (state: GameState, card: CardInstanceState) => void,
    active: "p1" | "p2" = "p2"
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [own(forest().id, "handLand", "hand")],
                graveyard: [own(forest().id, "graveyardFiller", "graveyard")],
                battlefield: [
                    own(mountain().id, "mountain0", "battlefield"),
                    own(plains().id, "plains0", "battlefield"),
                    own(plains().id, "plains1", "battlefield"),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(hillGiant().id, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: active,
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    place(state, own(cardId, "mdfc", "hand"));
    return state;
}

export const inGraveyard =
    (fields: Partial<CardInstanceState> = {}) =>
    (state: GameState, card: CardInstanceState) => {
        state.players[0].graveyard.push({
            ...card,
            zone: "graveyard",
            ...fields,
        });
    };
export const inExile =
    (fields: Partial<CardInstanceState>) =>
    (state: GameState, card: CardInstanceState) => {
        state.players[0].exile.push({
            ...card,
            zone: "exile",
            castableFromExileBy: "p1",
            ...fields,
        });
    };
export const yawgmothsWill = (state: GameState) => {
    state.graveyardPlayPermissionThisTurn = [
        { actions: ["cast"], sourceId: "yawgmoths-will", playerId: "p1" },
    ];
};

export type Licence = {
    name: string;
    cardId: string;
    place: (state: GameState, card: CardInstanceState) => void;
};

/** CR 712.11c — the generic permissions: each reaches the back face. */
export const GENERIC: Licence[] = [
    {
        name: "a per-card graveyard grant (Malcolm)",
        cardId: MODAL_INSTANT_BACK_PROBE_ID,
        place: inGraveyard({ castableFromGraveyardBy: "p1" }),
    },
    {
        name: "a graveyard play permission (Yawgmoth's Will)",
        cardId: MODAL_INSTANT_BACK_PROBE_ID,
        place: (state, card) => {
            inGraveyard()(state, card);
            yawgmothsWill(state);
        },
    },
    {
        name: "an impulse exile grant",
        cardId: MODAL_INSTANT_BACK_PROBE_ID,
        place: inExile({}),
    },
    {
        name: "a free exile grant (rebound, Dauthi Voidwalker)",
        cardId: MODAL_INSTANT_BACK_PROBE_ID,
        place: inExile({ castFromExileWithoutPayingManaCost: true }),
    },
    {
        name: "Bolas's Citadel's library top",
        cardId: MODAL_INSTANT_BACK_PROBE_ID,
        place: (state, card) => {
            state.players[0].library.unshift({ ...card, zone: "library" });
            state.players[0].battlefield.push(
                own(BOLAS_CITADEL, "citadel", "battlefield")
            );
        },
    },
];

/** CR 712.11c — the front face's own abilities: none reaches the back face. */
export const FRONT_FACE: (Licence & { ability: ModalFrontAbility })[] = [
    { ability: "flashback", place: inGraveyard() },
    { ability: "escape", place: inGraveyard() },
    { ability: "retrace", place: inGraveyard() },
    { ability: "intrinsic", place: inGraveyard() },
    {
        ability: "madness",
        place: inExile({ madnessExiled: true }),
    },
    {
        ability: "foretell",
        place: inExile({ foretold: true, castableFromExileFromTurn: 0 }),
    },
].map((row) => ({
    ...row,
    ability: row.ability as ModalFrontAbility,
    name: row.ability,
    cardId: modalFrontAbilityProbeId(row.ability as ModalFrontAbility),
}));

export const mdfcOf = (state: GameState): CardInstanceState => {
    const p1 = state.players[0];
    return [...p1.graveyard, ...p1.exile, ...p1.library].find(
        (c) => c.id === "mdfc"
    )!;
};
