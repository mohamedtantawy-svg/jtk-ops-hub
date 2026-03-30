import { Pool } from 'pg';
import { IAnnouncementRepository, AnnouncementFilter, AnnouncementPage, AnnouncementComment, AnnouncementLink } from '../../domain/announcement/IAnnouncementRepository';
import { Announcement, AnnouncementProps, AnnouncementType, AnnouncementTarget, AnnouncementStatus, AnnouncementPriority } from '../../domain/announcement/Announcement';

export class PostgresAnnouncementRepository implements IAnnouncementRepository {
  constructor(private readonly pool: Pool) {}

  private rowToAnnouncement(row: Record<string, any>): Announcement {
    const props: AnnouncementProps = {
      id: row.id,
      type: row.type as AnnouncementType,
      title: row.title,
      body: row.body,
      authorId: String(row.author_id),
      target: row.target as AnnouncementTarget,
      status: row.status as AnnouncementStatus,
      priority: row.priority as AnnouncementPriority,
      isPinned: row.is_pinned,
      isPopup: row.is_popup ?? false,
      imageUrl: row.image_url ?? '',
      link: row.link ?? '',
      reactions: row.reactions ?? {},
      sentAt: row.sent_at ? new Date(row.sent_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
    return Announcement.reconstitute(props);
  }

  async findById(id: string): Promise<Announcement | null> {
    const { rows } = await this.pool.query('SELECT * FROM announcements WHERE id = $1', [id]);
    return rows[0] ? this.rowToAnnouncement(rows[0]) : null;
  }

  async findAll(filter: AnnouncementFilter): Promise<AnnouncementPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (filter.status?.length) { conditions.push(`status = ANY($${p++})`); params.push(filter.status); }
    if (filter.target) { conditions.push(`(target = $${p++} OR target = 'all')`); params.push(filter.target); }
    if (filter.authorId) { conditions.push(`author_id = $${p++}`); params.push(filter.authorId); }
    if (filter.cursor) {
      const p1 = p++; const p2 = p++;
      conditions.push(`(created_at, id) < ($${p1}, $${p2})`);
      params.push(filter.cursor.createdAt, filter.cursor.id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = (filter.limit ?? 50) + 1;

    const { rows } = await this.pool.query(
      `SELECT * FROM announcements ${where} ORDER BY is_pinned DESC, created_at DESC, id DESC LIMIT $${p}`,
      [...params, limit],
    );

    const hasMore = rows.length === limit;
    const items = hasMore ? rows.slice(0, -1) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map(r => this.rowToAnnouncement(r)),
      hasMore,
      nextCursor: hasMore && last ? { createdAt: new Date(last.created_at), id: last.id } : null,
    };
  }

  async save(announcement: Announcement): Promise<void> {
    const s = announcement.toSnapshot();
    await this.pool.query(
      `INSERT INTO announcements (id, type, title, body, author_id, target, status, priority, is_pinned, is_popup, image_url, link, sent_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.type, s.title, s.body, s.authorId, s.target, s.status, s.priority, s.isPinned, s.isPopup, s.imageUrl, s.link, s.sentAt, s.createdAt, s.updatedAt],
    );
  }

  async update(announcement: Announcement): Promise<void> {
    const s = announcement.toSnapshot();
    await this.pool.query(
      `UPDATE announcements SET type=$2, title=$3, body=$4, target=$5, status=$6, priority=$7, is_pinned=$8, is_popup=$9, image_url=$10, link=$11, sent_at=$12, updated_at=$13 WHERE id=$1`,
      [s.id, s.type, s.title, s.body, s.target, s.status, s.priority, s.isPinned, s.isPopup, s.imageUrl, s.link, s.sentAt, s.updatedAt],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM announcements WHERE id = $1', [id]);
  }

  async markAsRead(announcementId: string, memberId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO announcement_reads (announcement_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [announcementId, memberId],
    );
  }

  async getReadCount(announcementId: string): Promise<number> {
    const { rows } = await this.pool.query(
      'SELECT COUNT(*)::int as count FROM announcement_reads WHERE announcement_id = $1',
      [announcementId],
    );
    return rows[0]?.count ?? 0;
  }

  async getReaders(announcementId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      'SELECT member_id FROM announcement_reads WHERE announcement_id = $1 ORDER BY read_at ASC',
      [announcementId],
    );
    return rows.map(r => String(r.member_id));
  }

  // ── Reactions ───────────────────────────────────────────────────────────────

  async react(id: string, emoji: string): Promise<void> {
    await this.pool.query(
      `UPDATE announcements SET reactions = jsonb_set(COALESCE(reactions, '{}'), ARRAY[$2], (COALESCE((reactions->>$2)::int, 0) + 1)::text::jsonb) WHERE id = $1`,
      [id, emoji],
    );
  }

  // ── Comments ────────────────────────────────────────────────────────────────

  async getComments(announcementId: string): Promise<AnnouncementComment[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM announcement_comments WHERE announcement_id = $1 ORDER BY created_at ASC',
      [announcementId],
    );
    return rows.map(r => ({
      id: r.id,
      announcementId: r.announcement_id,
      parentId: r.parent_id ?? null,
      authorId: String(r.author_id),
      body: r.body,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }));
  }

  async addComment(announcementId: string, parentId: string | null, authorId: string, body: string): Promise<AnnouncementComment> {
    const id = crypto.randomUUID();
    const now = new Date();
    await this.pool.query(
      `INSERT INTO announcement_comments (id, announcement_id, parent_id, author_id, body, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, announcementId, parentId, authorId, body, now, now],
    );
    return { id, announcementId, parentId, authorId, body, createdAt: now, updatedAt: now };
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.pool.query('DELETE FROM announcement_comments WHERE id = $1', [commentId]);
  }

  // ── Links ───────────────────────────────────────────────────────────────────

  async getLinkedAnnouncements(announcementId: string): Promise<AnnouncementLink[]> {
    const { rows } = await this.pool.query(
      `SELECT source_id, target_id, created_at FROM announcement_links
       WHERE source_id = $1 OR target_id = $1
       ORDER BY created_at ASC`,
      [announcementId],
    );
    return rows.map(r => ({
      sourceId: r.source_id,
      targetId: r.target_id,
      createdAt: new Date(r.created_at),
    }));
  }

  async linkAnnouncements(sourceId: string, targetId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO announcement_links (source_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [sourceId, targetId],
    );
  }

  async unlinkAnnouncements(sourceId: string, targetId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM announcement_links WHERE (source_id = $1 AND target_id = $2) OR (source_id = $2 AND target_id = $1)`,
      [sourceId, targetId],
    );
  }
}
