import { v4 as uuidv4 } from 'uuid';
import { IProjectRepository } from '../../../domain/project/IProjectRepository';
import { Project } from '../../../domain/project/Project';
import { CreateProjectCommand } from '../commands/CreateProjectCommand';
import { logger } from '../../../shared/logger';

export class CreateProjectHandler {
  constructor(private readonly projectRepo: IProjectRepository) {}

  async execute(cmd: CreateProjectCommand): Promise<string> {
    const project = Project.create({ id: uuidv4(), ...cmd });
    await this.projectRepo.save(project);
    logger.info('Project created', { projectId: project.id, title: cmd.title });
    return project.id;
  }
}
