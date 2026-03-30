import { ProjectPriority } from '../../../domain/project/Project';

export interface CreateProjectCommand {
  title: string;
  description: string | null;
  priority: ProjectPriority;
  ownerId: string;
  teamId: string | null;
  deadline: Date | null;
  tags: string[];
}
