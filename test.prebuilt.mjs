// Prebuilt-artifact manifest (specs/arch/test-runner/github-ci.md#build-once-fan-out).
// The authoritative statement of which deduplicated CI build recipe runs and
// which registry surfaces' preCommands it covers. The artifact packs untracked
// files and symlinks after the recipes, excluding dependency, repository, and
// test-run state; no output path is declared here. The registry stays what each
// surface needs; scripts/test/prebuilt.mjs checks the two are consistent.
export default {
  artifactName: "prebuilt-dists",
  builds: [
    {
      // The suite helper shares one licensing inventory root across the full
      // CLI composite build and desktop build. The CLI build subsumes web,
      // server, view, and skills builds.
      id: "products",
      command: ["node", "scripts/licenses/build-suite.mjs"],
      coversPreCommands: ["e2e:node", "e2e:browser-app", "e2e:browser-app-real-stack", "e2e:view-markdown", "e2e:desktop", "e2e:server"],
    },
  ],
};
