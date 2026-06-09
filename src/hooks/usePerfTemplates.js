// ── usePerfTemplates ────────────────────────────────────────────────────────
// Loads the current dept's evaluation templates for the Performance Settings
// editor + the Phase-C evaluation form. Managerial-only on the server (403 →
// empty). Exposes optimistic create/update/archive.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listPerfTemplates, createPerfTemplate, updatePerfTemplate, deletePerfTemplate,
} from '../services/performanceApi';

export function usePerfTemplates(enabled = true) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(null);

  const refresh = useCallback(() => {
    if (!enabled) return null;
    if (inFlightRef.current) return inFlightRef.current;
    setLoading(true);
    const run = (async () => {
      try {
        const res = await listPerfTemplates();
        setTemplates(Array.isArray(res?.templates) ? res.templates : []);
        setError(null);
      } catch (err) {
        if (err?.status === 403) { setTemplates([]); setError(null); }
        else setError(err?.message || 'Failed to load templates');
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (payload) => {
    const res = await createPerfTemplate(payload);
    refresh();
    return res?.template || null;
  }, [refresh]);

  const update = useCallback(async (id, patch) => {
    const res = await updatePerfTemplate(id, patch);
    if (res?.template) setTemplates(prev => prev.map(t => (t.id === id ? res.template : t)));
    return res?.template || null;
  }, []);

  const archive = useCallback(async (id) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
    try { await deletePerfTemplate(id); } catch (err) { refresh(); throw err; }
  }, [refresh]);

  return { templates, loading, error, refresh, create, update, archive };
}
