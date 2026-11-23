// The probe-kernel bench payload (issue #10471): the three arms over the same
// boards, bundled by `run-wasm-probe.mjs build` into one script that every
// engine runs unchanged, in a dedicated Worker. It exposes
// `globalThis.__wasmProbe`.
//
//   init(wasmBytes)                 build the boards, one kernel per arm and
//                                   board, and REFUSE to go on unless the
//                                   three arms return the same number for
//                                   every probe of every board
//   sample(arm, board, reps, phases)  time `reps` sweeps of the board's
//                                   candidates; `phases` < 4 stops a probe
//                                   early (1 clone, 2 + apply, 3 + settle)
//
// Arms: `A` objects, `B` flat memory in JavaScript, `C` the same layout in
// WebAssembly with the sweep inside the module, `Ccall` the same module with
// one call from JavaScript per probe.

import { buildBoards } from "./boards.mjs";
import { createFlatKernel } from "./kernel-flat.mjs";
import { createObjectKernel } from "./kernel-objects.mjs";
import {
    LAYOUT_WORDS,
    encodeBoard,
    encodeDefs,
    encodeMoves,
} from "./layout.mjs";

const boards = buildBoards();
/** Per board: the three arms' kernels, loaded. */
let kernels = [];

function instantiate(module, board) {
    const memory = new WebAssembly.Memory({ initial: 4 });
    const kernel = new WebAssembly.Instance(module, {
        env: { __linear_memory: memory },
    }).exports;
    LAYOUT_WORDS.forEach((word, i) => {
        if (kernel.layoutWord(i) !== word) {
            throw new Error(`wasm kernel: layout word ${i} disagrees`);
        }
    });
    const words = new Int32Array(memory.buffer);
    words.set(encodeDefs(), kernel.defsPtr() >> 2);
    words.set(encodeBoard(board), kernel.basePtr() >> 2);
    words.set(encodeMoves(board), kernel.movesPtr() >> 2);
    return kernel;
}

function init(wasmBytes) {
    // A plain array of bytes: it crosses a JSON transport unchanged.
    const module = new WebAssembly.Module(new Uint8Array(wasmBytes));
    kernels = boards.map((board) => {
        const A = createObjectKernel();
        A.load(board);
        const B = createFlatKernel(encodeDefs());
        B.load(encodeBoard(board), encodeMoves(board));
        const C = instantiate(module, board);
        const n = board.moves.length;
        for (let m = 0; m < n; m++) {
            const a = A.probe(m);
            if (a !== B.probe(m) || a !== C.probe(m)) {
                throw new Error(`${board.label}: the arms disagree on ${m}`);
            }
        }
        const checksum = A.run(n, 3);
        if (checksum !== B.run(n, 3) || checksum !== C.run(n, 3)) {
            throw new Error(`${board.label}: the arms' checksums disagree`);
        }
        return { A, B, C, n, checksum };
    });
    return boards.map((board, i) => ({
        label: board.label,
        permanents: board.permanents.length,
        candidates: board.moves.length,
        library: board.players.map((p) => p.library.length),
        cloneObjects: kernels[i].A.cloneSize(),
        checksum: kernels[i].checksum,
    }));
}

function sample(arm, index, reps, phases = 4) {
    const { A, B, C, n } = kernels[index];
    const t0 = performance.now();
    let checksum = 0;
    if (arm === "Ccall") {
        const probe = C.probe;
        for (let r = 0; r < reps; r++) {
            for (let m = 0; m < n; m++) {
                checksum = (Math.imul(checksum, 31) + probe(m)) | 0;
            }
        }
    } else {
        const kernel = arm === "A" ? A : arm === "B" ? B : C;
        checksum =
            phases === 4
                ? kernel.run(n, reps)
                : kernel.runUpTo(n, reps, phases);
    }
    const ms = performance.now() - t0;
    return { ms, probes: reps * n, checksum };
}

globalThis.__wasmProbe = { init, sample };
