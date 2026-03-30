import { IProjectRepository } from '../../../domain/project/IProjectRepository';
import { Project } from '../../../domain/project/Project';
import { GetProjectByIdQuery } from '../queries/GetProjectByIdQuery';
import { NotFoundError } from '../../../shared/errors';

export class GetProjectByIdHandler {
  constructor(private readonly projectRepo: IProjectRepository) {}

  async execute(query: GetProjectByIdQuery): Promise<Project> {
    const project = await this.projectRepo.findById(query.id);
    if (!project) throw new NotFoundError('Project', query.id);
    return project;
  }
}
