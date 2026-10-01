*How the Node version contracts are proven: repository declarations, the advisory floor in the packed CLI package, and the toolchain checker at its two developer entry points.*

# Node versions — proof

Proves [specs/arch/node-versions.md](../../specs/arch/node-versions.md).

## Coverage model

Repository contract tests read `.nvmrc`, the manifests and the build scripts directly and prove the declared values in the version tables. As the spec's Testing section requires, the published consumer floor is also checked, with no mocks, in the tarball `npm pack` produces for the CLI package, the only public package. The private desktop workspace declares no floor, which the [ToDesktop build proof](./desktop/distribution.md#^desktop-dist-t-workspace) checks, and the ToDesktop build's `nodeVersion` is checked against `.nvmrc` by [its configuration contract](./desktop/distribution.md#^desktop-dist-t-config). GitHub CI and Blaxel take Node from `.nvmrc` under their own proofs. The checker is proven over authored versions, and its install-hook and preflight wiring through the real entry points. The procedure for changing a contract orders no test.

## Assertions

Shapes per the [testing-policy.md](../../specs/arch/testing-policy.md) declaration schema.

- **Contract — declarations.** Repository assertions prove that `.nvmrc`, the private-root engines, the public CLI package's `engines.node`, the Node-side emitted-syntax targets of the CLI and desktop esbuild outputs, and the Node API type dependency match the table values. The public-package assertion protects the intentional difference between the advisory consumer floor and the lower emitted-syntax target — *(covered by test: `test/repo/node-toolchain.test.ts` “keeps the published consumer floor advisory while emitting Node 18-compatible syntax”)*. ^node-versions-t-declarations
- **Contract — packed public declaration** (the real CLI package built and packed with `npm pack`, then read from the extracted tarball; no mocks): the package manifest users receive declares the exact published consumer floor from the table — *(covered by test: `test/node/licensing.test.ts` “the CLI tarball retains the published Node consumer floor”)*. ^node-versions-t-packed-declarations
- **Contract — checker.** Script tests cover accepted and rejected Node/npm versions and the single diagnostic containing expected values, actual values, and `.nvmrc` guidance. ^node-versions-t-checker
- **Seam — developer entry points.** The root install hook and canonical `node` preflight invoke the checker; an unsupported toolchain exits nonzero, and the preflight stops before selected tests begin. ^node-versions-t-entry-points
