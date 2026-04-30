#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/backend"
npm install
out="$root/backend/api/colortrack-server.cjs"
npx --yes esbuild@0.24.2 index.js \
  --bundle --platform=node --format=cjs \
  --legal-comments=none \
  --external:expo-server-sdk \
  --external:@aws-sdk/client-s3 \
  --external:@aws-sdk/s3-request-presigner \
  --outfile="$out"
cd "$root/backend/api"
npm install
wc -c "$out"
