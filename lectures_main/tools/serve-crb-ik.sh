#!/usr/bin/env bash
# Keep this process running while using the lecture's live CRB slice controls.
set -euo pipefail
crb_tools_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
crb_manifest="$crb_tools_dir/../assets/abb_irb_ik/Cargo.toml"
cargo build --release --offline --manifest-path "$crb_manifest" --bin lecture_slice_server
exec "$crb_tools_dir/../assets/abb_irb_ik/target/release/lecture_slice_server" "$@"
