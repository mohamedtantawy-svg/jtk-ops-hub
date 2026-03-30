import { IProjectRepository } from '../../../domain/project/IProjectRepository';
import { UpdateProgressCommand } from '../commands/UpdateProgressCommand';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export class UpdateProgressHandler {
  constructor(private readonly projectRepo: IProjectRepository) {}

  async execute(cmd: UpdateProgressCommand): Promise<void> {
    if (cmd.progress < 0 || cmd.progress > 100) {
      throw new ValidationError(`Progress must be between 0 and 100, got ${cmd.progress}`);
    }

    const project = await this.projectRepo.findById(cmd.projectId);
    if (!project) throw new NotFoundError('Project', cmd.projectId);

    project.updateProgress(cmd.progress);
    await this.projectRepo.update(project);
    logger.info('Project progress updated', { projectId: cmd.projectId, progress: cmd.progress });
  }
}
