#!/bin/zsh
# builds the site and publishes it to vercel as project "sapphire", meant to be served at
# https://sapphire.orbitlabs.studio. needs bun and the vercel cli, signed in to the account that
# owns orbitlabs.studio. attach the domain to the project once. set NOTION_API_KEY and
# NOTION_WAITLIST_DATASOURCE_ID on the Vercel project for the waitlist.
set -euo pipefail
cd "$(dirname "$0")"
bun install --frozen-lockfile
bun run build
# deploy from this folder so /api/waitlist is included; static files come from dist via vercel.json.
# the folder is linked to the vercel project "sapphire" (.vercel/, not committed): link it once with
# vercel link --yes --project sapphire
vercel deploy --prod --yes
