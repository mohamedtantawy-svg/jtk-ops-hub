// ── useTrackerRows ─────────────────────────────────────────────────────────
// Loads ONE tracker's full detail (meta + column schema + rows) and exposes
// optimistic CRUD for the editable grid. Inline cell edits send only the
// changed column(s) via patchRow({cells:{<col>:value}}); the server merges so
// untouched cells survive. Clearing a cell sends an empty value (the server
// normalises it to JSON null = blank).
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getTracker, addTrackerRow, updateTrackerRow, deleteTrackerRow,
} from '../services/trackerApi';

export function useTrackerRows(trackerId, enabled = true) {
  const [tracker, setTracker] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(null);

  const refresh = useCallback(() => {
    if (!enabled || !trackerId) return null;
    setLoading(true);
    const run = (async () => {
      try {
        const res = await getTracker(trackerId);
        setTracker(res?.tracker || null);
        setRows(Array.isArray(res?.rows) ? res.rows : []);
        setError(null);
      } catch (err) {
        if (err?.status === 403) { setError(null); }
        else setError(err?.message || 'Failed to load tracker');
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [trackerId, enabled]);

  // Reset + reload whenever the active tracker changes.
  useEffect(() => { setTracker(null); setRows([]); refresh(); }, [refresh]);

  const addRow = useCallback(async (payload = {}) => {
    const res = await addTrackerRow(trackerId, payload);
    if (res?.row) setRows(prev => [...prev, res.row]);
    return res?.row || null;
  }, [trackerId]);

  const patchRow = useCallback(async (rowId, patch) => {
    // Optimistic local merge, reconciled with the server's returned row.
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const next = { ...r };
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.cells) next.cells = { ...r.cells, ...patch.cells };
      if (Number.isFinite(patch.sort)) next.sort = patch.sort;
      return next;
    }));
    try {
      const res = await updateTrackerRow(trackerId, rowId, patch);
      if (res?.row) setRows(prev => prev.map(r => (r.id === rowId ? res.row : r)));
      return res?.row || null;
    } catch (err) {
      refresh();   // drop the optimistic change on failure
      throw err;
    }
  }, [trackerId, refresh]);

  const deleteRow = useCallback(async (rowId) => {
    const snapshot = rows;
    setRows(prev => prev.filter(r => r.id !== rowId));   // optimistic
    try {
      await deleteTrackerRow(trackerId, rowId);
    } catch (err) {
      setRows(snapshot);   // restore on failure
      throw err;
    }
  }, [trackerId, rows]);

  return {
    tracker,
    rows,
    columnSchema: tracker?.columnSchema || [],
    loading,
    error,
    refresh,
    addRow,
    patchRow,
    deleteRow,
  };
}
