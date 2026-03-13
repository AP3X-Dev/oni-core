import type { LifecycleEvent, EventType, EventHandler, EventListeners } from "./types.js";

export class EventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>();
  private allHandlers = new Set<EventHandler<LifecycleEvent>>();
  private disposed = false;

  constructor(listeners?: EventListeners) {
    if (listeners) {
      for (const [type, handler] of Object.entries(listeners)) {
        if (handler) this.on(type as EventType, handler as EventHandler<any>);
      }
    }
  }

  on<T extends EventType>(
    type: T,
    handler: EventHandler<Extract<LifecycleEvent, { type: T }>>,
  ): () => void {
    if (this.disposed) return () => {};
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  onAll(handler: EventHandler<LifecycleEvent>): () => void {
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
    timeoutMs?: number,
  ): Promise<Extract<LifecycleEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsub = this.once(type, ((event: Extract<LifecycleEvent, { type: T }>) => {
        if (timer) clearTimeout(timer);
        resolve(event);
      }) as EventHandler<Extract<LifecycleEvent, { type: T }>>);

      if (timeoutMs != null) {
        timer = setTimeout(() => {
          unsub();
          reject(new Error(`waitFor("${type}") timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
    });
  }

  handlerCount(type: EventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  removeAll(): void {
    this.handlers.clear();
    this.allHandlers.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.removeAll();
  }
}
