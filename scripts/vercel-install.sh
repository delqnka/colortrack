#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/backend"
npm install
out="$root/api/colortrack-server.cjs"
npx --yes esbuild@0.24.2 index.js \
  --bundle --platform=node --format=cjs \
  --legal-comments=none \
  --external:expo-server-sdk \
  --external:@aws-sdk/client-s3 \
  --external:@aws-sdk/s3-request-presigner \
  --outfile="$out"
# Дублираме в lib/ за includeFiles + резерв, ако api/** се държа различно от NFT
mkdir -p "$root/lib"
cp "$out" "$root/lib/colortrack-server.cjs"
ls -la "$out" "$root/lib/colortrack-server.cjs"
cd "$root/api"
npm install
