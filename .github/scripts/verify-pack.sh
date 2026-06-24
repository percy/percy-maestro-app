#!/usr/bin/env bash
# Verifies the npm tarball contains EXACTLY the whitelisted files and nothing else.
# Authority for this list is RELEASING.md > "Pre-publish content audit".
# Used by both the Release workflow (pre-publish gate) and the pack-audit CI check.
set -euo pipefail

EXPECTED=$(cat <<'EOF'
CHANGELOG.md
LICENSE
README.md
package.json
percy/flows/percy-init.yaml
percy/flows/percy-screenshot.yaml
percy/scripts/percy-healthcheck.js
percy/scripts/percy-prepare-screenshot.js
percy/scripts/percy-screenshot.js
EOF
)

# `npm pack --json` lists tarball entries under .files[].path — strip the leading
# "package/" prefix npm adds, then sort for a stable diff.
ACTUAL=$(npm pack --dry-run --json \
  | node -e 'const f=require("fs");const d=JSON.parse(f.readFileSync(0,"utf8"));process.stdout.write(d[0].files.map(x=>x.path).join("\n"))' \
  | sort)

EXPECTED_SORTED=$(printf '%s\n' "$EXPECTED" | sort)

if ! diff <(printf '%s\n' "$EXPECTED_SORTED") <(printf '%s\n' "$ACTUAL") > /tmp/pack-diff.txt; then
  echo "::error::Tarball contents do not match the whitelist in RELEASING.md"
  echo "--- expected (left) vs actual (right) ---"
  cat /tmp/pack-diff.txt
  echo "Fix the \"files\" array in package.json before publishing."
  exit 1
fi

COUNT=$(printf '%s\n' "$EXPECTED" | wc -l | tr -d ' ')
echo "✅ Tarball contains exactly the ${COUNT} whitelisted files."
