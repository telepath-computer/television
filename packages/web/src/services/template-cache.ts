import { EventTarget } from "@rupertsworld/event-target";
import { ChangeEvent, type ArtifactTemplateScan, type TemplateClient } from "@telepath-computer/television-shared";

/** List and icon bytes owned by one server connection, including while its popover is closed. */
export class TemplateCache extends EventTarget<ChangeEvent> {
  scan: ArtifactTemplateScan | null = null;
  readonly icons = new Map<string, string>();
  #revision = 0;
  #requests = new Map<string, object>();
  #loading: Promise<void> | null = null;
  #needsLoad = true;
  #invalidateAll = false;
  #open = false;
  #disposed = false;

  readonly #client: () => TemplateClient;

  constructor(client: () => TemplateClient) {
    super();
    this.#client = client;
  }

  reset(): void {
    this.#revision++;
    this.#requests.clear();
    // Reconnect may have missed changes absent from the next push's invalidated IDs.
    this.#invalidateAll = true;
    this.#loading = null;
    this.#needsLoad = true;
  }

  load(fresh = false): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const revision = ++this.#revision;
    const loading = (async () => {
      try {
        const scan = await this.#client().list(fresh ? { fresh: true } : undefined);
        if (this.#disposed || revision !== this.#revision) return;
        this.#replace(scan, [...this.icons.keys(), ...this.#requests.keys()]);
      } catch {
        if (revision === this.#revision) this.#needsLoad = true;
      }
    })();
    this.#loading = loading;
    void loading.then(() => { if (this.#loading === loading) this.#loading = null; });
    return loading;
  }

  apply(event: { scan: ArtifactTemplateScan; invalidatedIDs: string[] }): void {
    if (this.#disposed) return;
    const lostWatcher = event.scan.watching === false && this.scan?.watching !== false;
    this.#revision++;
    this.#replace(event.scan, event.invalidatedIDs);
    if (lostWatcher && this.#open) void this.load(true);
  }

  setOpen(open: boolean): void {
    if (this.#disposed || open === this.#open) return;
    this.#open = open;
    if (!open) return;
    if (this.scan?.watching === false) void this.load(true);
    else if (this.#needsLoad && !this.#loading) void this.load();
  }

  #replace(scan: ArtifactTemplateScan, invalidated: string[]): void {
    this.scan = scan;
    this.#needsLoad = false;
    const refresh = new Set(this.#invalidateAll ? scan.templates.map(({ id }) => id) : invalidated);
    this.#invalidateAll = false;
    const available = new Set(scan.templates.filter(({ hasIcon }) => hasIcon).map(({ id }) => id));
    for (const id of new Set([...this.icons.keys(), ...this.#requests.keys()])) {
      if (!available.has(id)) this.#removeIcon(id);
      else if (refresh.has(id)) this.#requests.delete(id);
    }
    for (const id of available) {
      if (this.#requests.has(id) || (this.icons.has(id) && !refresh.has(id))) continue;
      const request = {};
      this.#requests.set(id, request);
      void this.#client().icon(id).then(({ bytes, contentType }) => {
        if (this.#disposed || this.#requests.get(id) !== request) return;
        const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: contentType }));
        this.#removeIcon(id);
        this.icons.set(id, url);
        this.dispatchEvent(new ChangeEvent("change"));
      }).catch(() => {
        if (this.#requests.get(id) !== request) return;
        this.#removeIcon(id);
        this.dispatchEvent(new ChangeEvent("change"));
      });
    }
    this.dispatchEvent(new ChangeEvent("change"));
  }

  #removeIcon(id: string): void {
    const url = this.icons.get(id);
    if (url) URL.revokeObjectURL(url);
    this.icons.delete(id);
    this.#requests.delete(id);
  }

  dispose(): void {
    this.#disposed = true;
    this.reset();
    for (const id of this.icons.keys()) this.#removeIcon(id);
  }
}
