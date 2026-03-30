import { ProjectPriority } from '../../../domain/project/Project';

export interface UpdateProjectCommand {
  id: string;
  title?: string;
  description?: string | null;
  priority?: ProjectPriority;
  teamId?: string | null;
  deadline?: Date | null;
  tags?: string[];
}
