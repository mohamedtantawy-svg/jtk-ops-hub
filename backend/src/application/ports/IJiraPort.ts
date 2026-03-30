export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  assigneeEmail: string | null;
  reporterEmail: string | null;
  labels: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
  projectKey: string;
}

export interface IJiraPort {
  getIssue(issueKey: string): Promise<JiraIssue>;
  searchIssues(jql: string, page?: number): Promise<{ issues: JiraIssue[]; total: number }>;
  updateIssueStatus(issueKey: string, transitionName: string): Promise<void>;
  addComment(issueKey: string, body: string): Promise<void>;
  assignIssue(issueKey: string, assigneeEmail: string): Promise<void>;
}
