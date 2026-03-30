import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GetNotesByTaskHandler } from '../../../application/note/handlers/GetNotesByTaskHandler';
import { CreateNoteHandler } from '../../../application/note/handlers/CreateNoteHandler';
import { DeleteNoteHandler } from '../../../application/note/handlers/DeleteNoteHandler';
import { Note } from '../../../domain/note/Note';

const CreateNoteSchema = z.object({
  body: z.string().min(1),
  isInternal: z.boolean().optional(),
});

function serializeNote(note: Note) {
  const s = note.toSnapshot();
  return {
    id: s.id,
    taskId: s.taskId,
    authorId: s.authorId,
    authorName: s.authorName,
    body: s.body,
    isInternal: s.isInternal,
    createdAt: s.createdAt,
  };
}

export class NoteController {
  constructor(
    private readonly getNotes: GetNotesByTaskHandler,
    private readonly createNote: CreateNoteHandler,
    private readonly deleteNote: DeleteNoteHandler,
  ) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const notes = await this.getNotes.execute({ taskId: req.params.taskId });
      res.json({ items: notes.map(serializeNote) });
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      const note = await this.createNote.execute({
        taskId: req.params.taskId,
        authorId: req.actor!.sub,
        authorName: req.actor!.name,
        body: parsed.data.body,
        isInternal: parsed.data.isInternal,
      });
      res.status(201).json(serializeNote(note));
    } catch (err) {
      next(err);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.deleteNote.execute({ noteId: req.params.noteId });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };
}
