#!/bin/sh
# Vercel's build command (vercel.json).
#
# - Production has CONVEX_DEPLOY_KEY: `convex deploy` typechecks and pushes the
#   functions and the schema, then runs `pnpm build` with VITE_CONVEX_URL set
#   to that deployment.
# - Preview builds have no deploy key: they build against the dev deployment
#   (VITE_CONVEX_URL in the Vercel preview env) and push nothing.
#
# `set -e`: a failed push fails the build, so the app is never built against
# functions that didn't deploy.
set -eu

if [ -n "${CONVEX_DEPLOY_KEY:-}" ]; then
  npx convex deploy --cmd 'pnpm build'
else
  pnpm build
fi
