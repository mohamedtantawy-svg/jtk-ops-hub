// ── Mention groups API client ──────────────────────────────────────────────
// Thin wrappers over apiFetch — same shape as the other service modules.
// Powers the ManageMentionGroupsModal and any future composer typeahead
// that needs to surface group handles alongside individual users.

import { apiFetch } from './api';

export async function listMentionGroups() {
  return apiFetch('/mention-groups');
}

export async function createMentionGroup({ handle, name, description, members }) {
  return apiFetch('/mention-groups', {
    method: 'POST',
    body: JSON.stringify({
      handle,
      name: name || null,
      description: description || null,
      members: Array.isArray(members) ? members : [],
    }),
  });
}

export async function updateMentionGroup(id, { name, description, members }) {
  return apiFetch(`/mention-groups/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(members !== undefined ? { members } : {}),
    }),
  });
}

export async function deleteMentionGroup(id) {
  return apiFetch(`/mention-groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
