#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/backend"
npm install
cd "$root/backend/api"
npm install
cd "$root/api"
npm install
