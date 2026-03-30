export interface ZendeskTicket {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assigneeEmail: string | null;
  requesterEmail: string | null;
  tags: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
  customFields: Record<string, unknown>;
}

export interface IZendeskPort {
  getTicket(ticketId: string): Promise<ZendeskTicket>;
  listOpenTickets(page?: number): Promise<{ tickets: ZendeskTicket[]; nextPage: number | null }>;
  updateTicketStatus(ticketId: string, status: string): Promise<void>;
  addComment(ticketId: string, body: string, isPublic?: boolean): Promise<void>;
  assignTicket(ticketId: string, assigneeEmail: string): Promise<void>;
}
