import { Pool } from 'pg';
import { INoteRepository } from '../../domain/note/INoteRepository';
import { Note, NoteProps } from '../../domain/note/Note';

export class PostgresNoteRepository implements INoteRepository {
  constructor(private readonly pool: Pool) {}

  private rowToNote(row: Record<string, any>): Note {
    const props: NoteProps = {
      id: String(row.id),
      taskId: row.task_id,
      authorId: row.author_id ? String(row.author_id) : '',
      authorName: row.author_name,
      body: row.body,
      isInternal: row.is_internal,
      createdAt: new Date(row.created_at),
    };
    return Note.reconstitute(props);
  }

  async findByTaskId(taskId: string): Promise<Note[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM task_notes WHERE task_id = $1 ORDER BY created_at DESC',
      [taskId],
    );
    return rows.map(r => this.rowToNote(r));
  }

  async save(note: Note): Promise<void> {
    const s = note.toSnapshot();
    await this.pool.query(
      `INSERT INTO task_notes (task_id, author_id, author_name, body, is_internal, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [s.taskId, s.authorId || null, s.authorName, s.body, s.isInternal, s.createdAt],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM task_notes WHERE id = $1', [id]);
  }
}
