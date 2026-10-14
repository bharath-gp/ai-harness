#!/bin/sh
# Push plugins/ into the session's hot-reloaded mods folder: scripts/dev-sync.sh <mods-folder>
cd "$(dirname "$0")/.." || exit 1
./scripts/sync-ui.sh
rsync -a --exclude '.claude-plugin/types' --exclude tsconfig.json plugins/ "$1"/
