import axios, { AxiosInstance } from 'axios';
import { IZendeskPort, ZendeskTicket } from '../../../application/ports/IZendeskPort';
import { config } from '../../../shared/config';
import { IntegrationError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

const PRIORITY_MAP: Record<string, string> = {
  urgent: 'critical',
  high: 'high',
  normal: 'medium',
  low: 'low',
};

export class ZendeskAdapter implements IZendeskPort {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `https://${config.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`,
      auth: {
        username: `${config.ZENDESK_EMAIL}/token`,
        password: config.ZENDESK_API_TOKEN ?? '',
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    });
  }

  private mapTicket(raw: any): ZendeskTicket {
    return {
      id: String(raw.id),
      subject: raw.subject ?? '(no subject)',
      description: raw.description ?? '',
      status: raw.status,
      priority: PRIORITY_MAP[raw.priority] ?? 'medium',
      assigneeEmail: raw.assignee?.email ?? null,
      requesterEmail: raw.requester?.email ?? null,
      tags: raw.tags ?? [],
      url: raw.url?.replace('/api/v2/tickets/', '/agent/tickets/').replace('.json', '') ?? '',
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      customFields: Object.fromEntries(
        (raw.custom_fields ?? []).map((f: any) => [f.id, f.value]),
      ),
    };
  }

  async getTicket(ticketId: string): Promise<ZendeskTicket> {
    try {
      const { data } = await this.client.get(`/tickets/${ticketId}.json?include=users`);
      return this.mapTicket(data.ticket);
    } catch (err: any) {
      throw new IntegrationError('Zendesk', `getTicket ${ticketId}: ${err.message}`);
    }
  }

  async listOpenTickets(page = 1): Promise<{ tickets: ZendeskTicket[]; nextPage: number | null }> {
    try {
      const { data } = await this.client.get('/tickets.json', {
        params: { status: 'open,pending,new', per_page: 100, page, include: 'users' },
      });
      return {
        tickets: data.tickets.map(this.mapTicket.bind(this)),
        nextPage: data.next_page ? page + 1 : null,
      };
    } catch (err: any) {
      throw new IntegrationError('Zendesk', `listOpenTickets: ${err.message}`);
    }
  }

  async updateTicketStatus(ticketId: string, status: string): Promise<void> {
    try {
      await this.client.put(`/tickets/${ticketId}.json`, {
        ticket: { status },
      });
    } catch (err: any) {
      throw new IntegrationError('Zendesk', `updateTicketStatus ${ticketId}: ${err.message}`);
    }
  }

  async addComment(ticketId: string, body: string, isPublic = false): Promise<void> {
    try {
      await this.client.put(`/tickets/${ticketId}.json`, {
        ticket: { comment: { body, public: isPublic } },
      });
    } catch (err: any) {
      throw new IntegrationError('Zendesk', `addComment ${ticketId}: ${err.message}`);
    }
  }

  async assignTicket(ticketId: string, assigneeEmail: string): Promise<void> {
    try {
      // Lookup user by email first
      const { data: userData } = await this.client.get('/users/search.json', {
        params: { query: assigneeEmail },
      });
      const user = userData.users?.[0];
      if (!user) throw new Error(`User not found: ${assigneeEmail}`);

      await this.client.put(`/tickets/${ticketId}.json`, {
        ticket: { assignee_id: user.id },
      });
    } catch (err: any) {
      throw new IntegrationError('Zendesk', `assignTicket ${ticketId}: ${err.message}`);
    }
  }
}
