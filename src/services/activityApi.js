import { apiFetch } from './api';

export async function fetchActivity(taskId) {
  return apiFetch(`/tasks/${taskId}/activity`);
}
