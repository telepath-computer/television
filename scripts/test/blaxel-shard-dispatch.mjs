export async function transferShardInputs({ write, planRemotePath, planRaw, remoteScript, remoteScriptContents }) {
  try {
    if (planRemotePath) await write(planRemotePath, planRaw);
    await write(remoteScript, remoteScriptContents);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error,
      failureKind: "transport",
      failureStep: "worker-dispatch",
      failureMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
