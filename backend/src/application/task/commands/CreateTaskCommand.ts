export interface CreateTaskCommand {
  externalId: string;
  source: string;
  subject: string;
  description: string;
  priority: string;
  assigneeId: string | null;
  reporterId: string | null;
  countryCode: string | null;
  tags: string[];
  externalUrl: string | null;
  sourceCreatedAt: Date;
}
