import { Request, Response, NextFunction } from 'express';
import { GetActivityByTaskHandler } from '../../../application/activity/handlers/GetActivityByTaskHandler';
import { Activity } from '../../../domain/activity/Activity';

function serializeActivity(a: Activity) {
  const s = a.toSnapshot();
  return {
    id: s.id,
    taskId: s.taskId,
    actorId: s.actorId,
    actorName: s.actorName,
    eventType: s.eventType,
    eventText: s.eventText,
    metadata: s.metadata,
    occurredAt: s.occurredAt,
  };
}

export class ActivityController {
  constructor(private readonly getActivity: GetActivityByTaskHandler) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const items = await this.getActivity.execute({ taskId: req.params.taskId });
      res.json({ items: items.map(serializeActivity) });
    } catch (err) {
      next(err);
    }
  };
}
