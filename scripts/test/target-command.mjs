export function targetCommand(target) {
  if (!target) return "";
  if (target.runner) return ["node", "scripts/test/target-native.mjs", JSON.stringify(target)].map(shellQuote).join(" ");
  const args = [
    "npm",
    "--workspace",
    target.workspace,
    "run",
    "test:e2e",
    "--if-present",
    "--",
  ];
  if (target.file) args.push(target.file);
  if (target.grep) args.push("-g", target.grep);
  args.push(`--retries=${target.retries}`, "--reporter=list");
  return args.map(shellQuote).join(" ");
}


function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
