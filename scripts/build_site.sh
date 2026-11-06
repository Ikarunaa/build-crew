#!/usr/bin/env bash
# Packages the portfolio for hosting: copies it into site/ and bundles the
# Build Crew engine next to it, so visitors can press Alt+Shift+B to watch the
# page rebuild itself. Deploy with:
#   npx wrangler pages deploy
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf site
mkdir -p site
cp portfolio/index.html portfolio/karuna.jpg portfolio/peakpad-icon.png site/
cp extension/content.js site/build-crew.js
# Locally the page loads the engine from ../extension/; online it sits beside the page.
sed -i '' "s#'../extension/content.js?' + Date.now()#'build-crew.js'#" site/index.html
grep -q "'build-crew.js'" site/index.html || { echo "engine path not rewritten" >&2; exit 1; }

cat > site/_headers <<'EOF'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
EOF

echo "site/ ready:"; ls -l site
