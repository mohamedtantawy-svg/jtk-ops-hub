import { Entity } from '../shared/Entity';

export interface NoteProps {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  isInternal: boolean;
  createdAt: Date;
}

export class Note extends Entity<string> {
  private props: NoteProps;

  private constructor(props: NoteProps) {
    super(props.id);
    this.props = props;
  }

  static create(params: Omit<NoteProps, 'createdAt'>): Note {
    return new Note({ ...params, createdAt: new Date() });
  }

  static reconstitute(props: NoteProps): Note {
    return new Note(props);
  }

  get taskId(): string { return this.props.taskId; }
  get authorId(): string { return this.props.authorId; }
  get authorName(): string { return this.props.authorName; }
  get body(): string { return this.props.body; }
  get isInternal(): boolean { return this.props.isInternal; }
  get createdAt(): Date { return this.props.createdAt; }

  toSnapshot(): NoteProps {
    return { ...this.props };
  }
}
