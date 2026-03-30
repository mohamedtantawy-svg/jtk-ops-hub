import { IAnnouncementRepository } from '../../../domain/announcement/IAnnouncementRepository';
import { Announcement } from '../../../domain/announcement/Announcement';
import { NotFoundError } from '../../../shared/errors';

export interface UpdateAnnouncementCommand {
  announcementId: string;
  type?: string;
  title?: string;
  body?: string;
  target?: string;
  priority?: string;
  isPopup?: boolean;
  imageUrl?: string;
  link?: string;
}

export class UpdateAnnouncementHandler {
  constructor(private readonly announcementRepo: IAnnouncementRepository) {}

  async execute(cmd: UpdateAnnouncementCommand): Promise<Announcement> {
    const ann = await this.announcementRepo.findById(cmd.announcementId);
    if (!ann) throw new NotFoundError('Announcement', cmd.announcementId);
    const { announcementId, ...fields } = cmd;
    ann.update(fields as any);
    await this.announcementRepo.update(ann);
    return ann;
  }
}
