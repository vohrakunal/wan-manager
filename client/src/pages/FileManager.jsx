import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '../components/Toast.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

const API = '/api/files';
const token = () => localStorage.getItem('token');
const authHdr = () => ({ Authorization: `Bearer ${token()}` });

function fmtSize(bytes) {
  if (bytes == null) return '—';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fileIcon(entry) {
  if (entry.isDir) return '📁';
  const ext = entry.name.split('.').pop().toLowerCase();
  const map = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    ppt: '📊', pptx: '📊', txt: '📄', md: '📄', csv: '📊',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼', svg: '🖼',
    mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬',
    mp3: '🎵', flac: '🎵', wav: '🎵',
    zip: '🗜', tar: '🗜', gz: '🗜', rar: '🗜', '7z': '🗜',
    iso: '💿', img: '💿',
    sh: '⚙️', py: '🐍', js: '⚙️', ts: '⚙️', json: '⚙️',
    conf: '⚙️', cfg: '⚙️', yml: '⚙️', yaml: '⚙️',
  };
  return map[ext] || '📄';
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function Breadcrumb({ currentPath, onNavigate }) {
  const parts = currentPath === '.' ? [] : currentPath.split('/').filter(Boolean);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, flexWrap: 'wrap' }}>
      <button
        onClick={() => onNavigate('.')}
        style={{ background: 'none', padding: '2px 4px', color: 'var(--accent2)', fontWeight: 600, fontSize: 13 }}
      >
        nas
      </button>
      {parts.map((p, i) => {
        const nav = parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        return (
          <React.Fragment key={i}>
            <span style={{ color: 'var(--text2)' }}>/</span>
            <button
              onClick={() => !isLast && onNavigate(nav)}
              style={{
                background: 'none', padding: '2px 4px', fontSize: 13,
                color: isLast ? 'var(--text)' : 'var(--accent2)',
                fontWeight: isLast ? 600 : 400,
                cursor: isLast ? 'default' : 'pointer',
              }}
            >
              {p}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Upload drop zone ──────────────────────────────────────────────────────────
function UploadZone({ currentPath, onDone }) {
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads]   = useState([]); // [{ name, progress, status }]
  const inputRef = useRef();

  async function uploadFiles(files) {
    const list = Array.from(files);
    setUploads(list.map(f => ({ name: f.name, progress: 0, status: 'uploading' })));

    await Promise.all(list.map((file, idx) => new Promise(resolve => {
      const fd = new FormData();
      fd.append('files', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/upload?path=${encodeURIComponent(currentPath)}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token()}`);

      xhr.upload.onprogress = e => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        setUploads(prev => prev.map((u, i) => i === idx ? { ...u, progress: pct } : u));
      };

      xhr.onload = () => {
        const ok = xhr.status >= 200 && xhr.status < 300;
        setUploads(prev => prev.map((u, i) => i === idx ? { ...u, status: ok ? 'done' : 'error', progress: 100 } : u));
        resolve();
      };
      xhr.onerror = () => {
        setUploads(prev => prev.map((u, i) => i === idx ? { ...u, status: 'error' } : u));
        resolve();
      };

      xhr.send(fd);
    })));

    setTimeout(() => { setUploads([]); onDone(); }, 1500);
  }

  const onDrop = e => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  };

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 8,
          padding: '20px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? 'rgba(47,129,247,0.06)' : 'transparent',
          transition: 'all 0.15s',
          marginBottom: uploads.length ? 10 : 0,
        }}
      >
        <div style={{ fontSize: 22, marginBottom: 4 }}>☁️</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          Drop files here or <span style={{ color: 'var(--accent2)' }}>click to browse</span>
        </div>
        <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files.length) uploadFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Progress bars */}
      {uploads.map((u, i) => (
        <div key={i} style={{ marginTop: 6, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>{u.name}</span>
            <span style={{ color: u.status === 'done' ? 'var(--green)' : u.status === 'error' ? 'var(--red)' : 'var(--text2)' }}>
              {u.status === 'done' ? '✓' : u.status === 'error' ? '✗' : `${u.progress}%`}
            </span>
          </div>
          <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${u.progress}%`,
              background: u.status === 'done' ? 'var(--green)' : u.status === 'error' ? 'var(--red)' : 'var(--accent)',
              borderRadius: 2, transition: 'width 0.2s',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FileManager() {
  const showToast = useToast();
  const toast = { success: m => showToast(m, 'success'), error: m => showToast(m, 'error') };

  const [currentPath, setCurrentPath] = useState('.');
  const [entries, setEntries]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState(new Set());
  const [filter, setFilter]           = useState('');

  // Modals
  const [showUpload, setShowUpload]     = useState(false);
  const [showMkdir, setShowMkdir]       = useState(false);
  const [mkdirName, setMkdirName]       = useState('');
  const [renameTarget, setRenameTarget] = useState(null); // entry
  const [renameName, setRenameName]     = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null); // entry or 'selected'

  const load = useCallback(async (p) => {
    const navPath = p ?? currentPath;
    setLoading(true);
    setSelected(new Set());
    try {
      const r = await fetch(`${API}/list?path=${encodeURIComponent(navPath)}`, { headers: authHdr() });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      const data = await r.json();
      setCurrentPath(data.path);
      setEntries(data.entries);
    } catch (err) {
      toast.error('Failed to load: ' + err.message);
    }
    setLoading(false);
  }, [currentPath]);

  useEffect(() => { load('.'); }, []);

  function navigate(p) { setFilter(''); load(p); }

  function toggleSelect(name) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(e => e.name)));
  }

  // Mkdir
  async function doMkdir(e) {
    e.preventDefault();
    const newPath = currentPath === '.' ? mkdirName : `${currentPath}/${mkdirName}`;
    try {
      const r = await fetch(`${API}/mkdir`, {
        method: 'POST',
        headers: { ...authHdr(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      toast.success(`Folder "${mkdirName}" created`);
      setShowMkdir(false);
      setMkdirName('');
      load();
    } catch (err) { toast.error(err.message); }
  }

  // Rename
  async function doRename(e) {
    e.preventDefault();
    const dir  = currentPath === '.' ? '' : currentPath + '/';
    const from = dir + renameTarget.name;
    const to   = dir + renameName;
    try {
      const r = await fetch(`${API}/rename`, {
        method: 'POST',
        headers: { ...authHdr(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      toast.success('Renamed');
      setRenameTarget(null);
      load();
    } catch (err) { toast.error(err.message); }
  }

  // Delete
  async function doDelete() {
    const targets = deleteTarget === 'selected'
      ? [...selected].map(name => {
          const dir = currentPath === '.' ? '' : currentPath + '/';
          return dir + name;
        })
      : [deleteTarget === '.' ? '.' : (currentPath === '.' ? '' : currentPath + '/') + deleteTarget.name];

    let ok = 0, fail = 0;
    for (const p of targets) {
      try {
        const r = await fetch(`${API}/delete`, {
          method: 'DELETE',
          headers: { ...authHdr(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        ok++;
      } catch { fail++; }
    }

    if (ok)   toast.success(`Deleted ${ok} item${ok > 1 ? 's' : ''}`);
    if (fail) toast.error(`Failed to delete ${fail} item${fail > 1 ? 's' : ''}`);
    setDeleteTarget(null);
    load();
  }

  function download(entry) {
    const p = currentPath === '.' ? entry.name : `${currentPath}/${entry.name}`;
    const a = document.createElement('a');
    a.href = `${API}/download?path=${encodeURIComponent(p)}&token=${token()}`;
    a.download = entry.name;
    a.click();
  }

  const filtered = entries.filter(e =>
    !filter || e.name.toLowerCase().includes(filter.toLowerCase())
  );

  const parentPath = currentPath === '.' ? null : currentPath.includes('/')
    ? currentPath.substring(0, currentPath.lastIndexOf('/'))
    : '.';

  const deleteMessage = deleteTarget === 'selected'
    ? `Permanently delete ${selected.size} selected item${selected.size > 1 ? 's' : ''}?`
    : deleteTarget
      ? `Permanently delete "${deleteTarget?.name || ''}"?${deleteTarget?.isDir ? ' This will remove the folder and all its contents.' : ''}`
      : '';

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">File Manager</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
            /mnt/nextcloud-storage/nas
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selected.size > 0 && (
            <button className="btn-danger" style={{ fontSize: 12 }}
              onClick={() => setDeleteTarget('selected')}>
              Delete ({selected.size})
            </button>
          )}
          <button className="btn-secondary" style={{ fontSize: 12 }}
            onClick={() => setShowMkdir(true)}>
            + New Folder
          </button>
          <button className="btn-primary" style={{ fontSize: 12 }}
            onClick={() => setShowUpload(v => !v)}>
            ↑ Upload
          </button>
          <button className="btn-secondary" style={{ fontSize: 12 }}
            onClick={() => load()} disabled={loading}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '8px 14px', marginBottom: 14,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {parentPath !== null && (
          <button
            onClick={() => navigate(parentPath)}
            style={{ background: 'none', padding: '2px 6px', color: 'var(--text2)', fontSize: 16 }}
            title="Go up"
          >
            ↑
          </button>
        )}
        <Breadcrumb currentPath={currentPath} onNavigate={navigate} />
      </div>

      {/* Upload zone */}
      {showUpload && (
        <div className="card section-gap">
          <UploadZone currentPath={currentPath} onDone={() => { setShowUpload(false); load(); }} />
        </div>
      )}

      {/* Filter */}
      <div style={{ marginBottom: 12 }}>
        <input
          placeholder="Filter files…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ maxWidth: 280 }}
        />
      </div>

      {/* File table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><span className="spinner" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
            {filter ? 'No files match the filter' : 'This folder is empty'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                      style={{ width: 'auto', cursor: 'pointer' }}
                    />
                  </th>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(entry => (
                  <tr key={entry.name} style={{ background: selected.has(entry.name) ? 'rgba(47,129,247,0.07)' : '' }}>
                    <td>
                      <input type="checkbox"
                        checked={selected.has(entry.name)}
                        onChange={() => toggleSelect(entry.name)}
                        style={{ width: 'auto', cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: entry.isDir ? 'pointer' : 'default' }}
                        onClick={() => entry.isDir && navigate(entry.path)}
                      >
                        <span style={{ fontSize: 18, lineHeight: 1 }}>{fileIcon(entry)}</span>
                        <span style={{
                          color: entry.isDir ? 'var(--accent2)' : 'var(--text)',
                          fontWeight: entry.isDir ? 600 : 400,
                          fontSize: 13,
                        }}>
                          {entry.name}
                        </span>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'monospace' }}>
                      {fmtSize(entry.size)}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {fmtDate(entry.modified)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {!entry.isDir && (
                          <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }}
                            onClick={() => download(entry)} title="Download">
                            ↓
                          </button>
                        )}
                        <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => { setRenameTarget(entry); setRenameName(entry.name); }}
                          title="Rename">
                          ✎
                        </button>
                        <button className="btn-danger" style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => setDeleteTarget(entry)} title="Delete">
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
            {selected.size > 0 && <span>{selected.size} selected</span>}
          </div>
        )}
      </div>

      {/* ── New Folder Modal ── */}
      {showMkdir && (
        <div style={overlayStyle} onClick={() => setShowMkdir(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 18, fontSize: 15 }}>New Folder</h3>
            <form onSubmit={doMkdir}>
              <input
                autoFocus
                placeholder="Folder name"
                value={mkdirName}
                onChange={e => setMkdirName(e.target.value)}
                pattern="[^/\\]+"
                required
                style={{ marginBottom: 16 }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowMkdir(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Rename Modal ── */}
      {renameTarget && (
        <div style={overlayStyle} onClick={() => setRenameTarget(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 18, fontSize: 15 }}>Rename</h3>
            <form onSubmit={doRename}>
              <input
                autoFocus
                value={renameName}
                onChange={e => setRenameName(e.target.value)}
                required
                style={{ marginBottom: 16 }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={() => setRenameTarget(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Rename</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete"
        message={deleteMessage}
        confirmLabel="Delete"
        danger
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '26px 30px', width: 360,
};
