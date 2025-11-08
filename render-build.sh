#!/usr/bin/env bash
set -euo pipefail

# Always install latest deps (including git refs) to avoid stale locks on Render
npm install --omit=dev

# Install backend service deps
cd backend
npm install --omit=dev
