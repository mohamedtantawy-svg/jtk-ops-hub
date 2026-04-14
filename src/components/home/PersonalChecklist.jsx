import { useState, useEffect } from 'react';

const STORAGE_KEY = 'ops_hub_checklist';

const PersonalChecklist = () => {
  const [items, setItems] = useState(() => {
    try { const d = localStorage.getItem(STORAGE_KEY); return d ? JSON.parse(d) : []; } catch(e) { return []; }
  });
  const [newText, setNewText] = useState('');

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch(e) {} }, [items]);

  const add = () => { if (!newText.trim()) return; setItems(prev => [...prev, { id: Date.now(), text: newText.trim(), done: false }]); setNewText(''); };
  const toggle = (id) => setItems(prev => prev.map(i => i.id === id ? { ...i, done: !i.done } : i));
  const remove = (id) => setItems(prev => prev.filter(i => i.id !== id));
  const doneCount = items.filter(i => i.done).length;

  return (
    <div style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg, #f3eff8, #EDE9FE)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="bi-check2-square" style={{ fontSize: 13, color: '#7c3aed' }}></i>
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b', flex: 1 }}>My Checklist</span>
        {items.length > 0 && <span style={{ fontSize: 11, color: '#9e9e9e', fontWeight: 600 }}>{doneCount}/{items.length}</span>}
      </div>
      <div style={{ padding: '10px 16px', maxHeight: 220, overflowY: 'auto' }}>
        {items.length === 0 && (
          <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: '#9e9e9e' }}>
            <i className="bi-list-check" style={{ fontSize: 20, display: 'block', marginBottom: 6, opacity: 0.4 }}></i>
            Add items to track your daily tasks
          </div>
        )}
        {items.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: '1px solid #f5f5f5' }}>
            <button onClick={() => toggle(item.id)} style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${item.done ? '#7c3aed' : '#d0d0d0'}`, background: item.done ? '#7c3aed' : 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s', padding: 0 }}>
              {item.done && <i className="bi-check" style={{ fontSize: 12, color: 'white' }}></i>}
            </button>
            <span style={{ fontSize: 13, color: item.done ? '#9e9e9e' : '#1b1b1b', textDecoration: item.done ? 'line-through' : 'none', flex: 1, fontWeight: 500 }}>{item.text}</span>
            <button onClick={() => remove(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d0d0d0', fontSize: 11, padding: '2px 4px', borderRadius: 4, transition: 'color .15s' }} onMouseEnter={e => e.currentTarget.style.color = '#d42d35'} onMouseLeave={e => e.currentTarget.style.color = '#d0d0d0'}>
              <i className="bi-x"></i>
            </button>
          </div>
        ))}
      </div>
      <div style={{ padding: '8px 16px 12px', display: 'flex', gap: 6 }}>
        <input value={newText} onChange={e => setNewText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="Add a task..." style={{ flex: 1, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b' }} onFocus={e => e.target.style.borderColor = '#7c3aed'} onBlur={e => e.target.style.borderColor = '#e8e8e8'} />
        <button onClick={add} disabled={!newText.trim()} style={{ height: 32, padding: '0 14px', borderRadius: 8, border: 'none', background: newText.trim() ? '#7c3aed' : '#e8e8e8', color: newText.trim() ? 'white' : '#9e9e9e', fontSize: 12, fontWeight: 700, cursor: newText.trim() ? 'pointer' : 'default', transition: 'all .15s' }}>
          <i className="bi-plus" style={{ fontSize: 14 }}></i>
        </button>
      </div>
    </div>
  );
};

export default PersonalChecklist;
