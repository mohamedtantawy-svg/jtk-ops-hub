import { google } from 'googleapis';
import { IGmailPort, GmailMessage } from '../../../application/ports/IGmailPort';
import { config } from '../../../shared/config';
import { IntegrationError } from '../../../shared/errors';

export class GmailAdapter implements IGmailPort {
  private gmail;

  constructor() {
    const auth = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
    );
    auth.setCredentials({ refresh_token: config.GOOGLE_REFRESH_TOKEN });
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  private decodeBody(raw: string): string {
    return Buffer.from(raw, 'base64url').toString('utf8');
  }

  private extractBody(payload: any): string {
    if (payload.body?.data) return this.decodeBody(payload.body.data);
    if (payload.parts) {
      const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) return this.decodeBody(textPart.body.data);
    }
    return '';
  }

  private mapMessage(raw: any): GmailMessage {
    const headers: Record<string, string> = Object.fromEntries(
      (raw.payload?.headers ?? []).map((h: any) => [h.name.toLowerCase(), h.value]),
    );
    return {
      id: raw.id,
      threadId: raw.threadId,
      subject: headers['subject'] ?? '(no subject)',
      body: this.extractBody(raw.payload ?? {}),
      from: headers['from'] ?? '',
      to: (headers['to'] ?? '').split(',').map((s: string) => s.trim()),
      labels: raw.labelIds ?? [],
      receivedAt: new Date(parseInt(raw.internalDate ?? '0', 10)),
      isRead: !(raw.labelIds ?? []).includes('UNREAD'),
    };
  }

  async listMessages(labelId?: string, pageToken?: string): Promise<{ messages: GmailMessage[]; nextPageToken: string | null }> {
    try {
      const listRes = await this.gmail.users.messages.list({
        userId: 'me',
        labelIds: labelId ? [labelId] : undefined,
        pageToken,
        maxResults: 50,
      });

      const messageIds = listRes.data.messages ?? [];
      const messages = await Promise.all(
        messageIds.map(m =>
          this.gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' })
            .then(r => this.mapMessage(r.data)),
        ),
      );

      return {
        messages,
        nextPageToken: listRes.data.nextPageToken ?? null,
      };
    } catch (err: any) {
      throw new IntegrationError('Gmail', `listMessages: ${err.message}`);
    }
  }

  async getMessage(messageId: string): Promise<GmailMessage> {
    try {
      const { data } = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });
      return this.mapMessage(data);
    } catch (err: any) {
      throw new IntegrationError('Gmail', `getMessage ${messageId}: ${err.message}`);
    }
  }

  async markAsRead(messageId: string): Promise<void> {
    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    } catch (err: any) {
      throw new IntegrationError('Gmail', `markAsRead ${messageId}: ${err.message}`);
    }
  }

  async sendReply(threadId: string, to: string, subject: string, body: string): Promise<void> {
    try {
      const raw = Buffer.from(
        `To: ${to}\r\nSubject: Re: ${subject}\r\nContent-Type: text/plain\r\n\r\n${body}`,
      ).toString('base64url');

      await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw, threadId },
      });
    } catch (err: any) {
      throw new IntegrationError('Gmail', `sendReply: ${err.message}`);
    }
  }
}
