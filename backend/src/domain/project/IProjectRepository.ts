import { Project, ProjectStatus, ProjectPriority } from './Project';

export interface ProjectFilter {
  ownerId?: string;
  teamId?: string;
  status?: ProjectStatus[];
  priority?: ProjectPriority[];
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}

export interface ProjectPage {
  items: Project[];
  hasMore: boolean;
  nextCursor: { createdAt: Date; id: string } | null;
}

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  findAll(filter: ProjectFilter): Promise<ProjectPage>;
  save(project: Project): Promise<void>;
  update(project: Project): Promise<void>;
  delete(id: string): Promise<void>;
}
