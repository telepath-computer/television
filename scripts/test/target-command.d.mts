export interface NativeTarget {
  runner?: string | null;
  cwd: string;
  config?: string | null;
  file?: string | null;
  files?: string[] | null;
  grep?: string | null;
  retries: string;
  command?: string[] | null;
  workspace?: string | null;
}
export function targetCommand(target: NativeTarget | null): string;
