import { DomainEvent } from './DomainEvent';

type EventHandler = (event: DomainEvent) => void | Promise<void>;

class EventBus {
  private handlers = new Map<string, EventHandler[]>();

  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    this.handlers.set(eventType, [...existing, handler]);
  }

  async dispatch(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      const handlers = this.handlers.get(event.eventType) || [];
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (err) {
          // Log but don't rethrow — side effects shouldn't break main flow
          console.error(`EventBus: handler failed for ${event.eventType}`, err);
        }
      }
    }
  }
}

export const eventBus = new EventBus();
