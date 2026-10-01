import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface ApplicationProtocolHandlerFixture {
  readonly markerPath: string;
  readonly env: Record<string, string>;
  readInvocation(): string | null;
  readInvocations(): string[];
  clearInvocations(): void;
  dispose(): void;
}

export function createApplicationProtocolHandler(
  scheme = "example-app",
): ApplicationProtocolHandlerFixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "television-protocol-handler-"));
  const dataHome = path.join(root, "data");
  const configHome = path.join(root, "config");
  const applicationsDir = path.join(dataHome, "applications");
  const binDir = path.join(root, "bin");
  const handlerPath = path.join(binDir, "handler.sh");
  const xdgOpenPath = path.join(binDir, "xdg-open");
  const markerPath = path.join(root, "invocation.txt");
  const desktopName = `${scheme}-television-test.desktop`;
  mkdirSync(applicationsDir, { recursive: true });
  mkdirSync(configHome, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(handlerPath, `#!/bin/sh\nprintf '%s\\n' "$1" >> ${JSON.stringify(markerPath)}\n`);
  writeFileSync(xdgOpenPath, "#!/bin/sh\nexec /usr/bin/gio open \"$@\"\n");
  chmodSync(handlerPath, 0o755);
  chmodSync(xdgOpenPath, 0o755);
  writeFileSync(path.join(applicationsDir, desktopName), `[Desktop Entry]
Type=Application
Name=Television test protocol handler
Exec=${handlerPath} %u
MimeType=x-scheme-handler/${scheme};
NoDisplay=true
Terminal=false
`);

  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    XDG_DATA_HOME: dataHome,
    XDG_CONFIG_HOME: configHome,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
  const registration = spawnSync("gio", ["mime", `x-scheme-handler/${scheme}`, desktopName], {
    env,
    encoding: "utf8",
  });
  if (registration.status !== 0) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`Unable to register ${scheme}: handler: ${registration.stderr || registration.stdout}`);
  }

  return {
    markerPath,
    env: {
      XDG_DATA_HOME: dataHome,
      XDG_CONFIG_HOME: configHome,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
    readInvocation(): string | null {
      const invocations = this.readInvocations();
      return invocations.at(-1) ?? null;
    },
    readInvocations(): string[] {
      return existsSync(markerPath)
        ? readFileSync(markerPath, "utf8").split("\n").filter(Boolean)
        : [];
    },
    clearInvocations(): void {
      rmSync(markerPath, { force: true });
    },
    dispose(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
