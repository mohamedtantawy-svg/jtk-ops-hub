import { IAnnouncementRepository } from '../../../domain/announcement/IAnnouncementRepository';
import { Announcement } from '../../../domain/announcement/Announcement';
import { NotFoundError } from '../../../shared/errors';

export class SendAnnouncementHandler {
  constructor(private readonly announcementRepo: IAnnouncementRepository) {}

  async execute(cmd: { announcementId: string }): Promise<Announcement> {
    const ann = await this.announcementRepo.findById(cmd.announcementId);
    if (!ann) throw new NotFoundError('Announcement', cmd.announcementId);
    ann.send();
    await this.announcementRepo.update(ann);
    return ann;
  }
}
