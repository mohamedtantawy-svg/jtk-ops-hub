import { IAnnouncementRepository } from '../../../domain/announcement/IAnnouncementRepository';
import { Announcement } from '../../../domain/announcement/Announcement';
import { NotFoundError } from '../../../shared/errors';

export class GetAnnouncementByIdHandler {
  constructor(private readonly announcementRepo: IAnnouncementRepository) {}

  async execute(query: { announcementId: string }): Promise<Announcement> {
    const ann = await this.announcementRepo.findById(query.announcementId);
    if (!ann) throw new NotFoundError('Announcement', query.announcementId);
    return ann;
  }
}
