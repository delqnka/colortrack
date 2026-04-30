#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/backend"
npm install
out_backend="$root/backend/api/colortrack-server.cjs"
out_root_api="$root/api/colortrack-server.cjs"
npx --yes esbuild@0.24.2 index.js \
  --bundle --platform=node --format=cjs \
  --legal-comments=none \
  --external:@aws-sdk/client-s3 \
  --external:@aws-sdk/s3-request-presigner \
  --outfile="$out_backend"
cp "$out_backend" "$out_root_api"
cd "$root/backend/api"
npm install
cd "$root/api"
npm install
wc -c "$out_backend" "$out_root_api"
