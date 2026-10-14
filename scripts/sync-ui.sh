#!/bin/sh
# Copy shared/ui.ts (and band.tsx for mods that use it) into plugins/*/hooks. Run after editing shared/.
cd "$(dirname "$0")/.." || exit 1
for d in plugins/*/hooks; do
  if grep -qE "from './(ui|band|kit)'" "$d"/register.tsx; then cp shared/ui.ts "$d"/ui.ts; fi
  if grep -q "from './band'" "$d"/register.tsx; then cp shared/band.tsx "$d"/band.tsx; fi
  if grep -q "from './kit'" "$d"/register.tsx; then cp shared/kit.tsx "$d"/kit.tsx; fi
done
