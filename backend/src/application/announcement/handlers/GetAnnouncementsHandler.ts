import { IAnnouncementRepository, AnnouncementFilter, AnnouncementPage } from '../../../domain/announcement/IAnnouncementRepository';

export class GetAnnouncementsHandler {
  constructor(private readonly announcementRepo: IAnnouncementRepository) {}

  async execute(filter: AnnouncementFilter): Promise<AnnouncementPage> {
    return this.announcementRepo.findAll(filter);
  }
}
