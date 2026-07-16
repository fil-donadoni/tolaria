// PROTOTYPE — throwaway. Mock hand + prompt for the Brainstorm "put back 2 on
// top" picker. Delete once a variant wins (see NOTES.md).
export type MockCard = { instanceId: string; defId: string };

// Real def ids so OrderCard pulls real art — feels like the board.
const DEF_IDS = [
    "2307fb16-8b77-45b5-8a02-51a13214791d",
    "5b616963-fac0-451c-8df4-2cacc9466b17",
    "6b086186-5fbf-4ba7-af0d-ee3ad61d27bb",
    "8d42d7aa-7f53-4cfc-842a-086aab2448d1",
    "46740353-e2ba-4d80-a97d-1368bc67bf30",
    "1005a00a-6a0e-44cb-abea-37e2e53125e2",
    "c4fdfc5b-c2ab-4c4d-b120-301e17f3d9c6",
    "61648ddb-6efb-43d0-b2b1-418cc957854c",
    "13ebb5dd-d7f1-4b06-8585-7004045be542",
];

// 9-card hand: post-draw Brainstorm state (drew 3, hand swelled). Player must
// put EXACTLY 2 on top, in chosen order.
export const MOCK_HAND: MockCard[] = DEF_IDS.map((defId, i) => ({
    instanceId: `h${i}`,
    defId,
}));

export const PUT_BACK_COUNT = 2;

export const PROMPT =
    "Put two cards from your hand on top of your library (topmost first).";
