#!/usr/bin/env bash
set -euo pipefail

# Login shells do not always load nvm from an interactive .bashrc.
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "Install Linux Node.js 22.13 or later in the 22.x line, or 24 or later, with npm in your default WSL distribution; then retry npm run dist:linux." >&2
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(process.platform === "linux" && (major > 24 || major === 24 || major === 22 && minor >= 13) ? 0 : 1)'; then
  echo "WSL must use Linux Node.js 22.13 or later in the 22.x line, or 24 or later, not the Windows Node.js installation." >&2
  exit 1
fi

exec node "$1/scripts/dist-linux.mjs" --wsl-build "$1"
