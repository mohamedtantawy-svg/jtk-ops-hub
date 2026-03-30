import { IProjectRepository } from '../../../domain/project/IProjectRepository';
import { NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export class DeleteProjectHandler {
  constructor(private readonly projectRepo: IProjectRepository) {}

  async execute(id: string): Promise<void> {
    const project = await this.projectRepo.findById(id);
    if (!project) throw new NotFoundError('Project', id);

    await this.projectRepo.delete(id);
    logger.info('Project deleted', { projectId: id });
  }
}
