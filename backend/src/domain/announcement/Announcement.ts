import { Entity } from '../shared/Entity';

export type AnnouncementType = 'alert' | 'announce' | 'update' | 'guidance' | 'kudos';
export type AnnouncementTarget = 'all' | 'EMEA' | 'APAC' | 'AMER';
export type AnnouncementStatus = 'draft' | 'sent' | 'archived';
export type AnnouncementPriority = 'low' | 'medium' | 'high' | 'critical';

export interface AnnouncementProps {
  id: string;
  type: AnnouncementType;
  title: string;
  body: string;
  authorId: string;
  target: AnnouncementTarget;
  status: AnnouncementStatus;
  priority: AnnouncementPriority;
  isPinned: boolean;
  isPopup: boolean;
  imageUrl: string;
  link: string;
  reactions: Record<string, number>;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Announcement extends Entity<string> {
  private props: AnnouncementProps;

  private constructor(props: AnnouncementProps) {
    super(props.id);
    this.props = props;
  }

  static create(params: Omit<AnnouncementProps, 'createdAt' | 'updatedAt' | 'status' | 'isPinned' | 'sentAt' | 'reactions'> & { reactions?: Record<string, number> }): Announcement {
    const now = new Date();
    return new Announcement({ ...params, status: 'draft', isPinned: false, sentAt: null, createdAt: now, updatedAt: now, isPopup: params.isPopup ?? false, imageUrl: params.imageUrl ?? '', link: params.link ?? '', reactions: params.reactions ?? {} });
  }

  static reconstitute(props: AnnouncementProps): Announcement {
    return new Announcement(props);
  }

  get type(): AnnouncementType { return this.props.type; }
  get title(): string { return this.props.title; }
  get body(): string { return this.props.body; }
  get authorId(): string { return this.props.authorId; }
  get target(): AnnouncementTarget { return this.props.target; }
  get status(): AnnouncementStatus { return this.props.status; }
  get priority(): AnnouncementPriority { return this.props.priority; }
  get isPinned(): boolean { return this.props.isPinned; }
  get isPopup(): boolean { return this.props.isPopup; }
  get imageUrl(): string { return this.props.imageUrl; }
  get link(): string { return this.props.link; }
  get reactions(): Record<string, number> { return this.props.reactions; }
  get sentAt(): Date | null { return this.props.sentAt; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  send(): void { this.props = { ...this.props, status: 'sent', sentAt: new Date(), updatedAt: new Date() }; }
  archive(): void { this.props = { ...this.props, status: 'archived', updatedAt: new Date() }; }
  unarchive(): void {
    if (this.props.status !== 'archived') throw new Error('Only archived announcements can be unarchived');
    this.props = { ...this.props, status: 'sent', updatedAt: new Date() };
  }
  pin(): void { this.props = { ...this.props, isPinned: true, updatedAt: new Date() }; }
  unpin(): void { this.props = { ...this.props, isPinned: false, updatedAt: new Date() }; }

  react(emoji: string): void {
    const reactions = { ...this.props.reactions };
    reactions[emoji] = (reactions[emoji] || 0) + 1;
    this.props = { ...this.props, reactions, updatedAt: new Date() };
  }

  update(fields: Partial<Pick<AnnouncementProps, 'type' | 'title' | 'body' | 'target' | 'priority' | 'isPopup' | 'imageUrl' | 'link'>>): void {
    this.props = { ...this.props, ...fields, updatedAt: new Date() };
  }

  toSnapshot(): AnnouncementProps { return { ...this.props }; }
}
