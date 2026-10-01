export function installNativeDialogMock(): () => void {
  const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement): void {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });

  return () => {
    restore("showModal", showModal);
    restore("close", close);
  };
}

function restore(
  name: "showModal" | "close",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
}
