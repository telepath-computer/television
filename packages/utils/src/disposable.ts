export interface DisposableLike {
  dispose(): void | Promise<void>;
  [Symbol.dispose](): void;
}

type Constructor<T = object> = abstract new (...args: any[]) => T;

function wrapDispose<T extends { dispose(): void | Promise<void> }>(
  target: T,
  isDisposed: () => boolean,
  setDisposed: () => void,
): void {
  const disposeImpl = target.dispose.bind(target);

  // eslint-disable-next-line no-restricted-syntax
  target.dispose = (() => {
    if (isDisposed()) {
      return;
    }
    setDisposed();
    return disposeImpl();
  }) as T["dispose"];
}

export abstract class Disposable implements DisposableLike {
  #disposed = false;

  constructor() {
    wrapDispose(this, () => this.#disposed, () => {
      this.#disposed = true;
    });
  }

  dispose(): void | Promise<void> {}

  [Symbol.dispose](): void {
    void this.dispose();
  }

  protected get disposed(): boolean {
    return this.#disposed;
  }
}

export function withDisposable<TBase extends Constructor>(Base: TBase) {
  abstract class WithDisposable extends Base implements DisposableLike {
    #disposed = false;

    abstract dispose(): void | Promise<void>;

    constructor(...args: any[]) {
      super(...args);
      wrapDispose(this, () => this.#disposed, () => {
        this.#disposed = true;
      });
    }

    [Symbol.dispose](): void {
      void this.dispose();
    }

    protected get disposed(): boolean {
      return this.#disposed;
    }
  }

  return WithDisposable;
}
