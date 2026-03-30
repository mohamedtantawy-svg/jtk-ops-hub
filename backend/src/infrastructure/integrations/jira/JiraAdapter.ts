import axios, { AxiosInstance } from 'axios';
import { IJiraPort, JiraIssue } from '../../../application/ports/IJiraPort';
import { config } from '../../../shared/config';
import { IntegrationError } from '../../../shared/errors';

const PRIORITY_MAP: Record<string, string> = {
  Highest: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
  Lowest: 'low',
};

export class JiraAdapter implements IJiraPort {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${config.JIRA_BASE_URL}/rest/api/3`,
      auth: {
        username: config.JIRA_EMAIL ?? '',
        password: config.JIRA_API_TOKEN ?? '',
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    });
  }

  private mapIssue(raw: any): JiraIssue {
    return {
      key: raw.key,
      summary: raw.fields.summary ?? '',
      description: raw.fields.description?.content?.[0]?.content?.[0]?.text ?? '',
      status: raw.fields.status?.name ?? 'To Do',
      priority: PRIORITY_MAP[raw.fields.priority?.name] ?? 'medium',
      assigneeEmail: raw.fields.assignee?.emailAddress ?? null,
      reporterEmail: raw.fields.reporter?.emailAddress ?? null,
      labels: raw.fields.labels ?? [],
      url: `${config.JIRA_BASE_URL}/browse/${raw.key}`,
      createdAt: raw.fields.created,
      updatedAt: raw.fields.updated,
      projectKey: raw.fields.project?.key ?? '',
    };
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    try {
      const { data } = await this.client.get(`/issue/${issueKey}`);
      return this.mapIssue(data);
    } catch (err: any) {
      throw new IntegrationError('Jira', `getIssue ${issueKey}: ${err.message}`);
    }
  }

  async searchIssues(jql: string, page = 0): Promise<{ issues: JiraIssue[]; total: number }> {
    try {
      const { data } = await this.client.post('/search', {
        jql,
        startAt: page * 50,
        maxResults: 50,
        fields: ['summary', 'description', 'status', 'priority', 'assignee', 'reporter', 'labels', 'project', 'created', 'updated'],
      });
      return {
        issues: data.issues.map(this.mapIssue.bind(this)),
        total: data.total,
      };
    } catch (err: any) {
      throw new IntegrationError('Jira', `searchIssues: ${err.message}`);
    }
  }

  async updateIssueStatus(issueKey: string, transitionName: string): Promise<void> {
    try {
      const { data } = await this.client.get(`/issue/${issueKey}/transitions`);
      const transition = data.transitions.find((t: any) =>
        t.name.toLowerCase() === transitionName.toLowerCase(),
      );
      if (!transition) throw new Error(`Transition not found: ${transitionName}`);

      await this.client.post(`/issue/${issueKey}/transitions`, {
        transition: { id: transition.id },
      });
    } catch (err: any) {
      throw new IntegrationError('Jira', `updateIssueStatus ${issueKey}: ${err.message}`);
    }
  }

  async addComment(issueKey: string, body: string): Promise<void> {
    try {
      await this.client.post(`/issue/${issueKey}/comment`, {
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
        },
      });
    } catch (err: any) {
      throw new IntegrationError('Jira', `addComment ${issueKey}: ${err.message}`);
    }
  }

  async assignIssue(issueKey: string, assigneeEmail: string): Promise<void> {
    try {
      // Find account ID by email
      const { data } = await this.client.get('/user/search', {
        params: { query: assigneeEmail },
      });
      const user = data?.[0];
      if (!user) throw new Error(`User not found: ${assigneeEmail}`);

      await this.client.put(`/issue/${issueKey}/assignee`, { accountId: user.accountId });
    } catch (err: any) {
      throw new IntegrationError('Jira', `assignIssue ${issueKey}: ${err.message}`);
    }
  }
}
