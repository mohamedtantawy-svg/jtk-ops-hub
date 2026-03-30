import { IAnnouncementRepository } from '../../../domain/announcement/IAnnouncementRepository';

export class MarkAnnouncementReadHandler {
  constructor(private readonly announcementRepo: IAnnouncementRepository) {}

  async execute(cmd: { announcementId: string; memberId: string }): Promise<void> {
    await this.announcementRepo.markAsRead(cmd.announcementId, cmd.memberId);
  }
}
