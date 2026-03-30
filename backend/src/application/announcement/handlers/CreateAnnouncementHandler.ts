import { v4 as uuidv4 } from 'uuid';
import { IAnnouncementRepository } from '../../../domain/announcement/IAnnouncementRepository';
import { Announcement, AnnouncementType, AnnouncementTarget, AnnouncementPriority } from '../../../domain/announcement/Announcement';

export interface CreateAnnouncementCommand {
  type: AnnouncementType;
  title: string;
  body: string;
  authorId: string;
  target?: AnnouncementTarget;
  priority?: AnnouncementPriority;
  isPopup?: boolean;
  imageUrl?: string;
  link?: string;
}

export class CreateAnnouncementHandler {
  constructor(private readonly announcementRepo: IAnnouncementRepository) {}

  async execute(cmd: CreateAnnouncementCommand): Promise<Announcement> {
    const announcement = Announcement.create({
      id: uuidv4(),
      type: cmd.type,
      title: cmd.title,
      body: cmd.body,
      authorId: cmd.authorId,
      target: cmd.target ?? 'all',
      priority: cmd.priority ?? 'medium',
      isPopup: cmd.isPopup ?? false,
      imageUrl: cmd.imageUrl ?? '',
      link: cmd.link ?? '',
    });
    await this.announcementRepo.save(announcement);
    return announcement;
  }
}
