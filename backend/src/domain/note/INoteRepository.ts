import { Note } from './Note';

export interface INoteRepository {
  findByTaskId(taskId: string): Promise<Note[]>;
  save(note: Note): Promise<void>;
  delete(id: string): Promise<void>;
}
