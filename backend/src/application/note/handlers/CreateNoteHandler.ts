import { v4 as uuidv4 } from 'uuid';
import { INoteRepository } from '../../../domain/note/INoteRepository';
import { Note } from '../../../domain/note/Note';
import { IActivityRepository } from '../../../domain/activity/IActivityRepository';
import { Activity } from '../../../domain/activity/Activity';

export interface CreateNoteCommand {
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  isInternal?: boolean;
}

export class CreateNoteHandler {
  constructor(
    private readonly noteRepo: INoteRepository,
    private readonly activityRepo: IActivityRepository,
  ) {}

  async execute(cmd: CreateNoteCommand): Promise<Note> {
    const note = Note.create({
      id: uuidv4(),
      taskId: cmd.taskId,
      authorId: cmd.authorId,
      authorName: cmd.authorName,
      body: cmd.body,
      isInternal: cmd.isInternal ?? true,
    });

    await this.noteRepo.save(note);

    // Log activity
    const activity = Activity.create({
      id: uuidv4(),
      taskId: cmd.taskId,
      actorId: cmd.authorId,
      actorName: cmd.authorName,
      eventType: 'note',
      eventText: `${cmd.authorName} added a note`,
      metadata: { noteId: note.id, isInternal: note.isInternal },
    });
    await this.activityRepo.save(activity);

    return note;
  }
}
