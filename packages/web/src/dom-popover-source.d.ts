// TypeScript 5.9's DOM lib predates the popover invoker option that
// specs/ui/foundation/panels/index.md ^po-invoker relies on. Drop this file
// once lib.dom declares ShowPopoverOptions itself.
interface ShowPopoverOptions {
  source?: HTMLElement;
}

interface HTMLElement {
  showPopover(options?: ShowPopoverOptions): void;
}
