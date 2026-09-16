# Fast live ABB CRB inverse kinematics

From the repository root, start the supplied Rust solver and keep it running:

```sh
bash lectures_main/tools/serve-crb-ik.sh
```

The lecture detects `http://127.0.0.1:8743` automatically. The server binds only
to the local machine. It uses the original Rust/Rug polynomial solver and a
shared Rayon pool of at most 16 available CPU threads. No changes to the robot
model or IK equations are made for speed. Override the limit if needed:

```sh
bash lectures_main/tools/serve-crb-ik.sh --threads 4
```

The launch script builds in release mode using cached Cargo dependencies.
On a fresh development machine, fetch those dependencies once before launching:

```sh
cargo fetch --manifest-path lectures_main/assets/abb_irb_ik/Cargo.toml
```

## Browser behavior

`js/viz/abbCrbCompute.js` exports
`computeSlice(slice, onProgress, {signal, backend, maxWorkers})`. Both xy and xz
payloads use world coordinates. The default backend is `auto`:

- With the local service, independent poses run in native Rust/Rayon batches.
- Without it, the same browser polynomial solver runs in a pool of up to eight
  WebWorkers, bounded by the available cores. This is JavaScript, and the UI
  reports it as such.
- A new request can cancel the previous one with `AbortController`. Browser
  workers terminate; the native server detects a closed stream when writing
  completed 512-cell tiles and checks cancellation before each remaining solve.
  At most two native requests can be active.
- Rare poses unresolved by Rust's adaptive solver and 512-bit reference retry
  receive a separate browser polynomial retry. Final metadata identifies this
  recovery. Cells unresolved by both methods stay **−1**, never zero.

Progress includes `done`, `total`, a global `start` index and contiguous `counts`
and `limitCounts` arrays. It also identifies the actual `backend` and `workers`.
Tiles may arrive out of order while `done` increases. A single full Rayon job
feeds a bounded result channel, so tile boundaries do not introduce computation
barriers or restart solver threads.
During sparse recovery, `done` remains the full pose count, and `recovery`
records its separate progress. Final results include timing and FK residuals.
Counts identify distinct geometric IK branches modulo 2π, including a legal
representative where one exists under the corrected joint limits.

The service streams newline-delimited JSON at `POST /slice` and provides its
version and worker count at `GET /health`. A different local port can be selected
with `--port`; set `globalThis.CRBIK_NATIVE_URL` before initializing the lecture
or pass `nativeUrl` to `computeSlice` to use that port.

## Verification

With the local lecture HTTP server and Chromium debugging available:

```sh
node --test lectures_main/tests/lecture-07-crb-compute.test.cjs
cargo test --offline --manifest-path lectures_main/assets/abb_irb_ik/Cargo.toml --bin lecture_slice_server
FULL_NATIVE=1 node lectures_main/tests/lecture-07-crb-compute-browser.cjs
```

The browser test compares Rust and parallel JavaScript results, checks both
cancellation routes, and verifies automatic fallback. The full benchmark
compares every count at all 100,000 poses in the verified xy backup, including
sparse root recovery. Its machine-specific timing report is written to
`/tmp/crb-native-benchmark-xy.json`.

The supplied crate currently depends on Rug's GMP/MPFR native libraries.
`cargo check --target wasm32-unknown-unknown` fails at that dependency's explicit
unsupported cross-compilation guard. This implementation therefore runs the
original solver natively; it does not describe the JavaScript fallback as Rust
or claim a working WASM build.
