#!/bin/sh
# Copy shared/{ui.ts,band.tsx,kit.tsx,rail.tsx,elapsed.tsx} into every plugins/*/hooks. Run after editing shared/.
cd "$(dirname "$0")/.." || exit 1
for d in plugins/*/hooks; do cp shared/ui.ts shared/band.tsx shared/kit.tsx shared/rail.tsx shared/elapsed.tsx "$d"/; done
