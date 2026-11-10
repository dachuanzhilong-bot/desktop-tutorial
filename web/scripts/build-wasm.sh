#!/usr/bin/env bash
# Builds the solver as WebAssembly and copies it to public/wasm/ (needs: rustup target add wasm32-unknown-unknown)
set -euo pipefail
cd "$(dirname "$0")/../../solver"
cargo build --release --lib --target wasm32-unknown-unknown
mkdir -p ../web/public/wasm
cp target/wasm32-unknown-unknown/release/tessera_solver.wasm ../web/public/wasm/tessera_solver.wasm
ls -l ../web/public/wasm/tessera_solver.wasm
