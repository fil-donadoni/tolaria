// SHA-256 (FIPS 180-4) over the UTF-8 bytes of a string — the hash the
// Verdict identity names objects by (issue #3575, ADR 0128 §3).
//
// WHY A HAND-WRITTEN DIGEST, and not `node:crypto` or `crypto.subtle`. The
// verdict id is computed in three places that must agree to the bit: the
// Convex mutation that stamps it at intake, the browser engine, and the
// scripts that verify the store. `node:crypto` exists in only one of those;
// `crypto.subtle.digest` is async, which a pure engine function cannot be and
// a Convex mutation's validation step should not be. Sixty lines of a
// published algorithm, cross-checked against `node:crypto` in the test, are
// cheaper than a runtime-dependent name.
//
// The UTF-8 encoding is hand-written for the same reason (no `TextEncoder`
// assumption): a lone surrogate is encoded as U+FFFD, exactly as
// `TextEncoder` and `Buffer.from(s, "utf8")` do, so the three runtimes cannot
// disagree even on malformed input.

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The UTF-8 bytes of `text`; a lone surrogate becomes U+FFFD. */
export function utf8Bytes(text: string): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                i++;
            } else {
                code = 0xfffd;
            }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            code = 0xfffd;
        }
        if (code < 0x80) {
            out.push(code);
        } else if (code < 0x800) {
            out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
            out.push(
                0xe0 | (code >> 12),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f)
            );
        } else {
            out.push(
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f)
            );
        }
    }
    return Uint8Array.from(out);
}

/** Lower-case hex SHA-256 of the UTF-8 bytes of `text`. */
export function sha256Hex(text: string): string {
    const bytes = utf8Bytes(text);
    // Padding: 0x80, zeros, then the bit length as a 64-bit big-endian integer,
    // to a multiple of 64 bytes.
    const blocks = Math.ceil((bytes.length + 9) / 64);
    const padded = new Uint8Array(blocks * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const bitLength = bytes.length * 8;
    view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(padded.length - 4, bitLength >>> 0);

    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
        0x1f83d9ab, 0x5be0cd19,
    ]);
    const w = new Uint32Array(64);
    for (let block = 0; block < blocks; block++) {
        const offset = block * 64;
        for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
        for (let t = 16; t < 64; t++) {
            const x = w[t - 15];
            const y = w[t - 2];
            const s0 =
                ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            const s1 =
                ((y >>> 17) | (y << 15)) ^
                ((y >>> 19) | (y << 13)) ^
                (y >>> 10);
            w[t] = w[t - 16] + s0 + w[t - 7] + s1;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let t = 0; t < 64; t++) {
            const s =
                ((e >>> 6) | (e << 26)) ^
                ((e >>> 11) | (e << 21)) ^
                ((e >>> 25) | (e << 7));
            const t1 = (hh + s + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0;
            const r =
                ((a >>> 2) | (a << 30)) ^
                ((a >>> 13) | (a << 19)) ^
                ((a >>> 22) | (a << 10));
            const t2 = (r + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) >>> 0;
        }
        h[0] += a;
        h[1] += b;
        h[2] += c;
        h[3] += d;
        h[4] += e;
        h[5] += f;
        h[6] += g;
        h[7] += hh;
    }
    let hex = "";
    for (const word of h) hex += word.toString(16).padStart(8, "0");
    return hex;
}
