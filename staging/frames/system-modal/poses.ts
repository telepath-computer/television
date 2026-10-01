const STATE_CONTROL_KEY = "state";
const DEFAULT_POSE = "connecting";

const SAMPLE_UPGRADE = {
  markdown: `# Sample upgrade instructions

Staging poses the production gate with sample copy supplied through its real markdown pipeline.

\`\`\`sh
sample-upgrade-command --for-staging
\`\`\`

Relaunch Television after the upgrade completes.`,
  instructions: `<h1>Sample upgrade instructions</h1>
<p>Staging poses the production gate with sample copy supplied through its real markdown pipeline.</p>
<pre><code class="language-sh">sample-upgrade-command --for-staging
</code></pre>
<p>Relaunch Television after the upgrade completes.</p>`,
} as const;

export const SYSTEM_MODAL_POSES = [
  { name: "connecting", state: "connecting" },
  {
    name: "disconnected-countdown",
    state: "disconnected",
    seconds: 3,
  },
  { name: "disconnected-now", state: "disconnected" },
  { name: "unauthorized", state: "unauthorized", invalid: false },
  { name: "unauthorized-invalid", state: "unauthorized", invalid: true },
  {
    name: "error",
    state: "error",
    serverURL: "https://example.com:7788",
    message: "Failed to fetch",
  },
  {
    name: "needs-upgrade",
    state: "needs-upgrade",
    upgrade: SAMPLE_UPGRADE,
  },
] as const;

export type SystemModalPose = (typeof SYSTEM_MODAL_POSES)[number];
export type SystemModalPoseName = SystemModalPose["name"];

type PoseGlobal = "__poseSystemModal" | "__poseSystemModalSpec";

interface SystemModalPoseWindow extends Window {
  __poseSystemModal?: (pose: SystemModalPoseName) => Promise<void>;
  __poseSystemModalSpec?: (pose: SystemModalPoseName) => Promise<void>;
}

interface SystemModalPoseDriver {
  readonly exposeAs: PoseGlobal;
  readonly ready?: () => Promise<unknown>;
  render(pose: SystemModalPose): Promise<void>;
}

/** Expose the staging pose driver and render the pose requested by the frame URL. */
export async function driveSystemModalPoses(driver: SystemModalPoseDriver): Promise<void> {
  const stagingWindow = window as unknown as SystemModalPoseWindow;
  const pose = async (name: SystemModalPoseName): Promise<void> => {
    await driver.render(poseFor(name));
  };
  stagingWindow[driver.exposeAs] = pose;

  await driver.ready?.();
  await pose(requestedPose());
  window.addEventListener("frameset:rendered", () => {
    void pose(requestedPose());
  });
}

function requestedPose(): SystemModalPoseName {
  return (
    poseFromSearch(location.search) ??
    poseFromSearch(embeddingFrameSearch()) ??
    DEFAULT_POSE
  );
}

function embeddingFrameSearch(): string {
  const frameElement = window.frameElement;
  if (frameElement === null) return "";
  const root = frameElement.getRootNode();
  // The shadow root belongs to the parent frame's realm, so an `instanceof`
  // check against this frame's ShadowRoot constructor cannot recognize it.
  const owner = (root as Partial<ShadowRoot>).host;
  if (owner === undefined) return "";
  const source = owner.getAttribute("src");
  return source === null ? "" : new URL(source, document.baseURI).search;
}

function poseFromSearch(search: string): SystemModalPoseName | null {
  const pose = new URLSearchParams(search).get(STATE_CONTROL_KEY);
  return isSystemModalPoseName(pose) ? pose : null;
}

function isSystemModalPoseName(value: unknown): value is SystemModalPoseName {
  return typeof value === "string" && SYSTEM_MODAL_POSES.some(({ name }) => name === value);
}

function poseFor(name: SystemModalPoseName): SystemModalPose {
  return SYSTEM_MODAL_POSES.find((pose) => pose.name === name)!;
}
