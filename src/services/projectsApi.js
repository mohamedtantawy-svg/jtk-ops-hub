import { apiFetch } from './api';

export async function fetchProjects({ ownerId, teamId, status, priority, cursor, limit } = {}) {
  const params = new URLSearchParams();
  if (ownerId) params.set('ownerId', String(ownerId));
  if (teamId) params.set('teamId', teamId);
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch(`/projects${qs ? `?${qs}` : ''}`);
}

export async function fetchProjectById(id) {
  return apiFetch(`/projects/${id}`);
}

export async function createProject(payload) {
  return apiFetch('/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateProject(id, fields) {
  return apiFetch(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function updateProjectProgress(id, progress) {
  return apiFetch(`/projects/${id}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ progress }),
  });
}

export async function deleteProject(id) {
  return apiFetch(`/projects/${id}`, { method: 'DELETE' });
}

// Milestones
export async function fetchMilestones(projectId) {
  return apiFetch(`/projects/${projectId}/milestones`);
}

export async function addMilestone(projectId, { title, dueDate, sortOrder }) {
  return apiFetch(`/projects/${projectId}/milestones`, {
    method: 'POST',
    body: JSON.stringify({ title, dueDate, sortOrder }),
  });
}

export async function updateMilestone(projectId, milestoneId, fields) {
  return apiFetch(`/projects/${projectId}/milestones/${milestoneId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function deleteMilestone(projectId, milestoneId) {
  return apiFetch(`/projects/${projectId}/milestones/${milestoneId}`, { method: 'DELETE' });
}

// Project members
export async function fetchProjectMembers(projectId) {
  return apiFetch(`/projects/${projectId}/members`);
}

export async function addProjectMember(projectId, memberId, role) {
  return apiFetch(`/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ memberId, role }),
  });
}

export async function removeProjectMember(projectId, memberId) {
  return apiFetch(`/projects/${projectId}/members/${memberId}`, { method: 'DELETE' });
}

// Linked tasks
export async function fetchLinkedTasks(projectId) {
  return apiFetch(`/projects/${projectId}/tasks`);
}

export async function linkTask(projectId, taskId) {
  return apiFetch(`/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ taskId }),
  });
}

export async function unlinkTask(projectId, taskId) {
  return apiFetch(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' });
}
