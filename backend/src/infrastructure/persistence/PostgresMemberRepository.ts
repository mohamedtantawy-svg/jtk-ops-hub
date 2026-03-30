import { Pool } from 'pg';
import { IMemberRepository, MemberFilter, MemberPage } from '../../domain/member/IMemberRepository';
import { Member, MemberProps, MemberRole, MemberRegion } from '../../domain/member/Member';

export class PostgresMemberRepository implements IMemberRepository {
  constructor(private readonly pool: Pool) {}

  private rowToMember(row: Record<string, any>): Member {
    const props: MemberProps = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role as MemberRole,
      team: row.team ?? null,
      region: row.region as MemberRegion ?? null,
      leadId: row.lead_id ?? null,
      avatarUrl: row.avatar_url ?? null,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
    return Member.reconstitute(props);
  }

  async findById(id: string): Promise<Member | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM members WHERE id = $1',
      [id],
    );
    return rows[0] ? this.rowToMember(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<Member | null> {
    if (!email) return null;
    const { rows } = await this.pool.query(
      'SELECT * FROM members WHERE email = $1',
      [email],
    );
    return rows[0] ? this.rowToMember(rows[0]) : null;
  }

  async findAll(filter: MemberFilter): Promise<MemberPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (filter.role?.length) {
      conditions.push(`role = ANY($${p++})`);
      params.push(filter.role);
    }
    if (filter.region) {
      conditions.push(`region = $${p++}`);
      params.push(filter.region);
    }
    if (filter.isActive !== undefined) {
      conditions.push(`is_active = $${p++}`);
      params.push(filter.isActive);
    }
    if (filter.cursor) {
      const p1 = p++; const p2 = p++;
      conditions.push(`(created_at, id) < ($${p1}, $${p2})`);
      params.push(filter.cursor.createdAt, filter.cursor.id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = (filter.limit ?? 50) + 1;

    const { rows } = await this.pool.query(
      `SELECT * FROM members ${where} ORDER BY created_at DESC, id DESC LIMIT $${p}`,
      [...params, limit],
    );

    const hasMore = rows.length === limit;
    const items = hasMore ? rows.slice(0, -1) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map(r => this.rowToMember(r)),
      hasMore,
      nextCursor: hasMore && last
        ? { createdAt: new Date(last.created_at), id: last.id }
        : null,
    };
  }

  async save(member: Member): Promise<void> {
    const s = member.toSnapshot();
    await this.pool.query(
      `INSERT INTO members (id, name, email, role, team, region, lead_id, avatar_url, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (email) DO NOTHING`,
      [s.id, s.name, s.email, s.role, s.team, s.region, s.leadId, s.avatarUrl, s.isActive, s.createdAt, s.updatedAt],
    );
  }

  async update(member: Member): Promise<void> {
    const s = member.toSnapshot();
    await this.pool.query(
      `UPDATE members SET name=$2, role=$3, team=$4, region=$5, lead_id=$6, avatar_url=$7, is_active=$8, updated_at=$9
       WHERE id=$1`,
      [s.id, s.name, s.role, s.team, s.region, s.leadId, s.avatarUrl, s.isActive, s.updatedAt],
    );
  }
}
