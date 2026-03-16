import type { LifecycleEvent, EventType, EventHandler, EventListeners } from "./types.js";

export class EventBus {
  // EventHandler is covariant in the event type; store as LifecycleEvent and narrow at callsite.
  private handlers = new Map<string, Set<EventHandler<LifecycleEvent>>>();
  private allHandlers = new Set<EventHandler<LifecycleEvent>>();
  private disposed = false;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private pendingRejects = new Set<(err: Error) => void>();

  constructor(listeners?: EventListeners) {
    if (listeners) {
      for (const [type, handler] of Object.entries(listeners)) {
        if (handler) this.on(type as EventType, handler as EventHandler<LifecycleEvent>);
      }
    }
  }

  on<T extends EventType>(
    type: T,
    handler: EventHandler<Extract<LifecycleEvent, { type: T }>>,
  ): () => void {
    if (this.disposed) return () => {};
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as EventHandler<LifecycleEvent>);
    return () => {
      this.handlers.get(type)?.delete(handler as EventHandler<LifecycleEvent>);
    };
  }

  onAll(handler: EventHandler<LifecycleEvent>): () => void {
    if (this.disposed) return () => {};
    this.allHandlers.add(handler);
    return () => {
      this.allHandlers.delete(handler);
    };
  }

  emit(event: LifecycleEvent): void {
    if (this.disposed) return;
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const h of typeHandlers) {
        try {
          h(event);
        } catch (err) {
          console.error(`[EventBus] listener error on "${event.type}":`, err);
        }
      }
    }
    for (const h of this.allHandlers) {
      try {
        h(event);
      } catch (err) {
        console.error(`[EventBus] onAll listener error on "${event.type}":`, err);
      }
    }
  }

  once<T extends EventType>(
    type: T,
    handler: EventHandler<Extract<LifecycleEvent, { type: T }>>,
  ): () => void {
    const unsub = this.on(type, ((event: Extract<LifecycleEvent, { type: T }>) => {
      unsub();
      handler(event);
    }) as EventHandler<Extract<LifecycleEvent, { type: T }>>);
    return unsub;
  }

  waitFor<T extends EventType>(
    type: T,
    timeoutMs = 60_000,
  ): Promise<Extract<LifecycleEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.pendingTimers.delete(timer);
        this.pendingRejects.delete(reject);
      };
      const timer = setTimeout(() => {
        cleanup();
        unsub();
        reject(new Error(`waitFor("${type}") timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingTimers.add(timer);
      this.pendingRejects.add(reject);
      const unsub = this.once(type, ((event: Extract<LifecycleEvent, { type: T }>) => {
        clearTimeout(timer);
        cleanup();
        resolve(event);
      }) as EventHandler<Extract<LifecycleEvent, { type: T }>>);
    });
  }

  handlerCount(type: EventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  removeAll(): void {
    const disposedError = new Error("EventBus disposed");
    for (const reject of this.pendingRejects) {
      reject(disposedError);
    }
    this.pendingRejects.clear();
    this.handlers.clear();
    this.allHandlers.clear();
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.removeAll();
  }
}
