import { IProjectRepository } from '../../../domain/project/IProjectRepository';
import { Project } from '../../../domain/project/Project';
import { UpdateProjectCommand } from '../commands/UpdateProjectCommand';
import { NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export class UpdateProjectHandler {
  constructor(private readonly projectRepo: IProjectRepository) {}

  async execute(cmd: UpdateProjectCommand): Promise<Project> {
    const project = await this.projectRepo.findById(cmd.id);
    if (!project) throw new NotFoundError('Project', cmd.id);

    const { title, description, priority, teamId, deadline, tags } = cmd;
    project.update({ title, description, priority, teamId, deadline, tags });

    await this.projectRepo.update(project);
    logger.info('Project updated', { projectId: cmd.id });
    return project;
  }
}
