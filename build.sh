#!/usr/bin/env bash

# Pipefail on

set -euo pipefail

# Variables

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/web/frontend"
OUT_BIN="${OUT_BIN:-${ROOT_DIR}/echo}"

# Set Flags

export CGO_ENABLED=1
export CGO_CFLAGS="${CGO_CFLAGS:-} -O3 -I${HOME}/.local/include"
export CGO_LDFLAGS="${CGO_LDFLAGS:-} -L${HOME}/.local/lib -Wl,-rpath,${HOME}/.local/lib"
export PKG_CONFIG_PATH="${HOME}/.local/lib/pkgconfig:${PKG_CONFIG_PATH:-}"

# Start Building

echo "Building React dashboard -> ${FRONTEND_DIR}"

cd "${FRONTEND_DIR}"

if [ ! -d node_modules ]; then

	bun install

fi

bun run build

cd "${ROOT_DIR}"

echo "Building Go binary -> ${OUT_BIN}"

go build -trimpath -o "${OUT_BIN}" ./

echo "Done. Run: ${OUT_BIN}"
