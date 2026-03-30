import { WebClient } from '@slack/web-api';
import { ISlackPort } from '../../../application/ports/ISlackPort';
import { config } from '../../../shared/config';
import { IntegrationError } from '../../../shared/errors';

export class SlackAdapter implements ISlackPort {
  private readonly client: WebClient;

  constructor() {
    this.client = new WebClient(config.SLACK_BOT_TOKEN);
  }

  async postMessage(channelId: string, text: string, threadTs?: string): Promise<string> {
    try {
      const res = await this.client.chat.postMessage({
        channel: channelId,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      return res.ts ?? '';
    } catch (err: any) {
      throw new IntegrationError('Slack', `postMessage: ${err.message}`);
    }
  }

  async getUser(userId: string): Promise<{ id: string; email: string; name: string } | null> {
    try {
      const res = await this.client.users.info({ user: userId });
      if (!res.user) return null;
      return {
        id: res.user.id ?? userId,
        email: res.user.profile?.email ?? '',
        name: res.user.real_name ?? res.user.name ?? '',
      };
    } catch {
      return null;
    }
  }

  async getPermalink(channelId: string, ts: string): Promise<string> {
    try {
      const res = await this.client.chat.getPermalink({ channel: channelId, message_ts: ts });
      return res.permalink ?? '';
    } catch (err: any) {
      throw new IntegrationError('Slack', `getPermalink: ${err.message}`);
    }
  }
}
