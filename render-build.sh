#!/usr/bin/env bash
set -euo pipefail

# Install root deps (bots)
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

# Install backend service deps
cd backend
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi
