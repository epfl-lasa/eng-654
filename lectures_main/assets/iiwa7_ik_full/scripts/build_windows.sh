#!/usr/bin/env bash
set -euo pipefail

# Build a native Windows x64 executable with compiler support linked statically.
# Prerequisites: rustup target add x86_64-pc-windows-gnu and MinGW-w64.
# Set IIWA7_MINGW_ROOT to an extracted MinGW package root for a local toolchain.
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${IIWA7_MINGW_ROOT:-}" ]]; then
    export PATH="${IIWA7_MINGW_ROOT}/usr/bin:${PATH}"
    export GCC_EXEC_PREFIX="${IIWA7_MINGW_ROOT}/usr/lib/gcc/"
    mingw_compiler="${IIWA7_MINGW_ROOT}/usr/bin/x86_64-w64-mingw32-gcc-posix"
else
    mingw_compiler="${IIWA7_MINGW_CC:-x86_64-w64-mingw32-gcc}"
fi
if ! command -v "${mingw_compiler}" >/dev/null; then
    printf 'MinGW compiler not found: %s\n' "${mingw_compiler}" >&2
    exit 1
fi
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="${mingw_compiler}"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS="-C target-feature=+crt-static -C link-arg=-static -C link-arg=-static-libgcc"
cargo build --release --locked --manifest-path "${project_dir}/Cargo.toml" --target x86_64-pc-windows-gnu "$@"
printf 'Windows binary: %s/target/x86_64-pc-windows-gnu/release/iiwa7-ik.exe\n' "${project_dir}"
