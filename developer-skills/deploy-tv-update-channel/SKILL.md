---
name: deploy-tv-update-channel
description: Deploy Television's public update channel, https://television.run/update-channel.json, from its master copy in the Television repository. Use when asked to deploy or publish the update channel, announce a Television release to users, change or retract the update notice or its desktop upgrade instructions, or bring the public update-channel.json up to date with the repository.
---

# Deploy the Television update channel

Release builds of the Television server poll `https://television.run/update-channel.json` by default and relay what it says to their clients: an update notice when the announced release is newer than the server, and upgrade instructions for desktop apps too old for their server. Its master copy is `specs/arch/updates/update-channel.json` in the Television repository, `telepath-computer/television`. Deploying makes the public file a verbatim copy of the master copy on freshly fetched, merged Television `origin/main`.

`specs/arch/updates/update-channel.md` governs the channel: the document's schema, what goes in it, and how it is published. The runbook `specs/arch/updates/runbook-channel-deploy.md` owns the procedure. It covers announcing a release, which starts with a Television pull request to the master copy and sometimes a required-desktop-version bump, and publishing a master-copy change that has already merged.

The website repository is `telepath-computer/television.run`, where the channel file is `site/public/update-channel.json`. The site deploys from its `main`, so merging a site pull request publishes the channel; leave merging to the human.

The site is a DigitalOcean App Platform static site behind Cloudflare. App Platform fixes `Cache-Control: public,max-age=10,s-maxage=86400`, so the edge may hold a file for up to a day, and each site deployment invalidates the edge cache. Verify a deploy by fetching the plain `https://television.run/update-channel.json`, with no query string, and confirming it serves the new master copy, which shows the edge cache was invalidated. Do not verify with a cache-busting query, which does not check the cached response at the plain public URL.

The notice's upgrade prompt normally sends users' agents to `https://television.run/install.md`, which the `deploy-tv-admin-guide` skill publishes.
