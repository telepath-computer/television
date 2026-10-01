import type { TestService } from "./config.mjs";

export interface RunningSurfaceService {
  id: string;
  url: string;
  port: number;
}

export interface SurfaceServices {
  env: NodeJS.ProcessEnv;
  services: RunningSurfaceService[];
  stop(): Promise<void>;
}

export function startSurfaceServices(
  services: readonly TestService[],
  options?: { env?: NodeJS.ProcessEnv; root?: string },
): Promise<SurfaceServices>;
