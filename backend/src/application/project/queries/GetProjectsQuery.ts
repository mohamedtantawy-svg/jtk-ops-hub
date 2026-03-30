import { ProjectStatus, ProjectPriority } from '../../../domain/project/Project';

export interface GetProjectsQuery {
  ownerId?: string;
  teamId?: string;
  status?: ProjectStatus[];
  priority?: ProjectPriority[];
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}
