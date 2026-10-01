*The standalone administrator guide: procedural authority, human review, source and publication.*

# Administrator guide

The *administrator guide* (also called the *admin guide*) is the standalone document an agent loads to help a person install, configure, upgrade, or administer Television. Its source is [docs/guides/television-admin-guide.md](../../../docs/guides/television-admin-guide.md), and its public location is `https://television.run/install.md`.

## Authority

The guide governs administration procedures and what the administering agent asks or tells the user. This is an explicit exception to the general non-authoritative status of guides in [spec policy](../../spec-policy.md). Changes to these instructions require human review. Product behavior remains governed by its owning specs, including [CLI behavior](../../product/cli.md) and [telemetry disclosure](../../product/telemetry.md#Disclosure); those specs win on a conflict.

## Publication

The public guide is self-contained: its instructions do not depend on repository-relative links or other repository documents. Publication copies the source verbatim from freshly fetched, merged Television `origin/main` to `site/public/install.md` in the website repository. Updating the Television source does not itself deploy the website.

## Testing

Check guide content by review and publication by byte comparison with the selected merged source. This document orders no wording tests and does not claim that tests prove an administering agent follows the instructions.
