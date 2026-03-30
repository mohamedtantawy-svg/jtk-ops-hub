import { INoteRepository } from '../../../domain/note/INoteRepository';

export class DeleteNoteHandler {
  constructor(private readonly noteRepo: INoteRepository) {}

  async execute(cmd: { noteId: string }): Promise<void> {
    await this.noteRepo.delete(cmd.noteId);
  }
}
