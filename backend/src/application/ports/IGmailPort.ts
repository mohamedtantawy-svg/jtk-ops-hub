export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  body: string;
  from: string;
  to: string[];
  labels: string[];
  receivedAt: Date;
  isRead: boolean;
}

export interface IGmailPort {
  listMessages(labelId?: string, pageToken?: string): Promise<{ messages: GmailMessage[]; nextPageToken: string | null }>;
  getMessage(messageId: string): Promise<GmailMessage>;
  markAsRead(messageId: string): Promise<void>;
  sendReply(threadId: string, to: string, subject: string, body: string): Promise<void>;
}
