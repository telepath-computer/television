---
name: deploy-tv-admin-guide
description: Publish the Television administrator guide to https://television.run/install.md. Use when asked to deploy or publish the admin guide, or to bring the public install.md up to date with the Television repository.
---

# Deploy the Television admin guide

The administrator guide's source is `docs/guides/television-admin-guide.md` in the Television repository, `telepath-computer/television`. Its public copy is `https://television.run/install.md`, which users hand to their agents to install and upgrade Television. Deploying makes the public copy match the source.

`specs/arch/cli/admin-guide.md` governs publication: the public file is a verbatim copy of the guide taken from freshly fetched, merged Television `origin/main`, and publication is checked by byte comparison with that source.

The website repository is `telepath-computer/television.run`, where the guide is `site/public/install.md`. The site deploys automatically from its `main`, so merging publishes. Stage the update on a `thopter/*` branch as a pull request into the site's `main` that names the Television commit it copies, and leave merging to the human.

The site is a DigitalOcean App Platform static site behind Cloudflare. App Platform fixes `Cache-Control: public,max-age=10,s-maxage=86400`, so the edge may hold a file for up to a day, and each site deployment invalidates the edge cache. Verify a deploy by fetching the plain `https://television.run/install.md`, with no query string, and confirming it serves the new guide; that is what users get. Do not verify with a cache-busting query, which does not check the cached response at the plain public URL.
