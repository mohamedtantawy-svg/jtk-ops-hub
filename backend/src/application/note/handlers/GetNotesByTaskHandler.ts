import { INoteRepository } from '../../../domain/note/INoteRepository';
import { Note } from '../../../domain/note/Note';

export class GetNotesByTaskHandler {
  constructor(private readonly noteRepo: INoteRepository) {}

  async execute(query: { taskId: string }): Promise<Note[]> {
    return this.noteRepo.findByTaskId(query.taskId);
  }
}
