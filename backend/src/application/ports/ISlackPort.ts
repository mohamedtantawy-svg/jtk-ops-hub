export interface SlackMessage {
  ts: string;
  channelId: string;
  userId: string;
  text: string;
  threadTs: string | null;
  createdAt: Date;
}

export interface ISlackPort {
  postMessage(channelId: string, text: string, threadTs?: string): Promise<string>;
  getUser(userId: string): Promise<{ id: string; email: string; name: string } | null>;
  getPermalink(channelId: string, ts: string): Promise<string>;
}
