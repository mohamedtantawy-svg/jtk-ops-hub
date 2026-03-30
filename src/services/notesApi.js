import { apiFetch } from './api';

export async function fetchNotes(taskId) {
  return apiFetch(`/tasks/${taskId}/notes`);
}

export async function createNote(taskId, { body, isInternal }) {
  return apiFetch(`/tasks/${taskId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body, isInternal }),
  });
}

export async function deleteNote(taskId, noteId) {
  return apiFetch(`/tasks/${taskId}/notes/${noteId}`, { method: 'DELETE' });
}
