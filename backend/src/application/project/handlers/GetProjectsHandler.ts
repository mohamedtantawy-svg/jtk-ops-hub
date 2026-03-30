import { IProjectRepository, ProjectPage } from '../../../domain/project/IProjectRepository';
import { GetProjectsQuery } from '../queries/GetProjectsQuery';

export class GetProjectsHandler {
  constructor(private readonly projectRepo: IProjectRepository) {}

  async execute(query: GetProjectsQuery): Promise<ProjectPage> {
    return this.projectRepo.findAll(query);
  }
}
