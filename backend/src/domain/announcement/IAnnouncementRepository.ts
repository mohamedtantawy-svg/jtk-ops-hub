import { Announcement, AnnouncementStatus, AnnouncementTarget } from './Announcement';

export interface AnnouncementFilter {
  status?: AnnouncementStatus[];
  target?: AnnouncementTarget;
  authorId?: string;
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}

export interface AnnouncementPage {
  items: Announcement[];
  hasMore: boolean;
  nextCursor: { createdAt: Date; id: string } | null;
}

export interface AnnouncementComment {
  id: string;
  announcementId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnnouncementLink {
  sourceId: string;
  targetId: string;
  createdAt: Date;
}

export interface IAnnouncementRepository {
  findById(id: string): Promise<Announcement | null>;
  findAll(filter: AnnouncementFilter): Promise<AnnouncementPage>;
  save(announcement: Announcement): Promise<void>;
  update(announcement: Announcement): Promise<void>;
  delete(id: string): Promise<void>;
  markAsRead(announcementId: string, memberId: string): Promise<void>;
  getReadCount(announcementId: string): Promise<number>;
  getReaders(announcementId: string): Promise<string[]>;

  // Reactions
  react(id: string, emoji: string): Promise<void>;

  // Comments
  getComments(announcementId: string): Promise<AnnouncementComment[]>;
  addComment(announcementId: string, parentId: string | null, authorId: string, body: string): Promise<AnnouncementComment>;
  deleteComment(commentId: string): Promise<void>;

  // Links
  getLinkedAnnouncements(announcementId: string): Promise<AnnouncementLink[]>;
  linkAnnouncements(sourceId: string, targetId: string): Promise<void>;
  unlinkAnnouncements(sourceId: string, targetId: string): Promise<void>;
}
