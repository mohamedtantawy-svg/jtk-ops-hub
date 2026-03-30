import { eventBus } from '../../domain/shared/EventBus';
import { DomainEvent } from '../../domain/shared/DomainEvent';
import { IActivityRepository } from '../../domain/activity/IActivityRepository';
import { Activity } from '../../domain/activity/Activity';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../shared/logger';

export function registerTaskEventSubscribers(activityRepo: IActivityRepository): void {
  eventBus.on('task.created', async (event: DomainEvent & { source?: string; assigneeId?: string | null }) => {
    try {
      const activity = Activity.create({
        id: uuidv4(),
        taskId: event.aggregateId,
        actorId: 'system',
        actorName: 'System',
        eventType: 'created',
        eventText: `Task created from ${event.source ?? 'unknown'}`,
        metadata: { source: event.source, assigneeId: event.assigneeId },
      });
      await activityRepo.save(activity);
    } catch (err) {
      logger.error('Failed to log task.created activity', { err });
    }
  });

  eventBus.on('task.assigned', async (event: DomainEvent & { assigneeId?: string; previousAssigneeId?: string | null }) => {
    try {
      const activity = Activity.create({
        id: uuidv4(),
        taskId: event.aggregateId,
        actorId: event.assigneeId ?? 'system',
        actorName: 'System',
        eventType: event.previousAssigneeId ? 'reassigned' : 'assigned',
        eventText: event.previousAssigneeId
          ? `Task reassigned from ${event.previousAssigneeId} to ${event.assigneeId}`
          : `Task assigned to ${event.assigneeId}`,
        metadata: { assigneeId: event.assigneeId, previousAssigneeId: event.previousAssigneeId },
      });
      await activityRepo.save(activity);
    } catch (err) {
      logger.error('Failed to log task.assigned activity', { err });
    }
  });

  eventBus.on('task.status_changed', async (event: DomainEvent & { previousStatus?: string; newStatus?: string; actorId?: string }) => {
    try {
      const activity = Activity.create({
        id: uuidv4(),
        taskId: event.aggregateId,
        actorId: event.actorId ?? 'system',
        actorName: 'System',
        eventType: event.newStatus === 'resolved' ? 'resolved' : 'status',
        eventText: `Status changed from ${event.previousStatus} to ${event.newStatus}`,
        metadata: { previousStatus: event.previousStatus, newStatus: event.newStatus },
      });
      await activityRepo.save(activity);
    } catch (err) {
      logger.error('Failed to log task.status_changed activity', { err });
    }
  });

  eventBus.on('task.escalated', async (event: DomainEvent & { managerId?: string; actorId?: string }) => {
    try {
      const activity = Activity.create({
        id: uuidv4(),
        taskId: event.aggregateId,
        actorId: event.actorId ?? 'system',
        actorName: 'System',
        eventType: 'escalated',
        eventText: `Task escalated to manager ${event.managerId}`,
        metadata: { managerId: event.managerId },
      });
      await activityRepo.save(activity);
    } catch (err) {
      logger.error('Failed to log task.escalated activity', { err });
    }
  });

  logger.info('Task event subscribers registered');
}
