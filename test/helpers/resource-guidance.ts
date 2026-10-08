/**
 * Reading the resource guidance's complete artifact example
 * (specs/arch/resources/guidance.md#^rg-teaches): the guidance's one fenced
 * `html` block, taken unchanged, the comment that documents its store's data,
 * and the guidance's commands for working on its list as the agent.
 */

/** The guidance's complete artifact example, exactly as the document carries it. */
export function artifactExample(guidance: string): string {
  const blocks = [...guidance.matchAll(/^```html\n([\s\S]*?)^```$/gm)].map((match) => match[1]!);
  if (blocks.length !== 1) throw new Error(`The resource guidance has ${blocks.length} fenced html blocks; it must have exactly one, its complete example.`);
  return blocks[0]!;
}

/** The comment lines directly above code's one `getStore()` call, without their `//` markers. */
export function storeComment(code: string): string[] {
  const lines = code.split("\n");
  const calls = lines.flatMap((line, index) => (/\bgetStore\(\)/.test(line) ? [index] : []));
  if (calls.length !== 1) throw new Error(`The code calls getStore() ${calls.length} times; it must call it once.`);
  const comment: string[] = [];
  for (let index = calls[0]! - 1; index >= 0 && /^\s*\/\//.test(lines[index]!); index -= 1) {
    comment.unshift(lines[index]!.replace(/^\s*\/\/ ?/, ""));
  }
  return comment;
}

/** The guidance's commands for working on its example's list as the agent: the shell block of its "as the agent" section, each line as argv. */
export function agentCommands(guidance: string): string[][] {
  const section = guidance.split(/^(?=## )/m).find((part) => /^## [^\n]*as the agent/.test(part));
  if (section === undefined) throw new Error("The resource guidance has no section on working on the example as the agent.");
  const block = /^```bash\n([\s\S]*?)^```$/m.exec(section)?.[1];
  if (block === undefined) throw new Error("The agent section has no shell block.");
  return block.split("\n").filter((line) => line.startsWith("tv ")).map(shellWords);
}

/** A command line's words, with single-quoted words unquoted, as a POSIX shell reads the lines the guidance writes. */
function shellWords(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2]!);
}
