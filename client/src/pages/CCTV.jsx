import React, { useState, useEffect, useRef } from 'react';
import { getCameras, addCamera, updateCamera, deleteCamera } from '../api/index.js';

const MIME = 'video/mp4; codecs="avc1.640029"';

function CameraFeed({ camera, onSelect, selected, fullscreen }) {
  const videoRef = useRef(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !window.MediaSource || !MediaSource.isTypeSupported(MIME)) {
      setErr('MSE not supported in this browser');
      return;
    }

    const ms = new MediaSource();
    const srcUrl = URL.createObjectURL(ms);
    video.src = srcUrl;

    const abort = new AbortController();
    let sb = null;
    const queue = [];
    let appending = false;

    function pump() {
      if (appending || queue.length === 0 || sb.updating) return;
      appending = true;
      sb.appendBuffer(queue.shift());
    }

    ms.addEventListener('sourceopen', async () => {
      try {
        sb = ms.addSourceBuffer(MIME);
      } catch (e) {
        setErr('Codec not supported: ' + e.message);
        return;
      }
      sb.mode = 'sequence';
      sb.addEventListener('updateend', () => { appending = false; pump(); });

      let res;
      try {
        res = await fetch(`/api/cameras/go2rtc/api/stream.mp4?src=${encodeURIComponent(camera.id)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          signal: abort.signal,
        });
      } catch (e) {
        if (e.name !== 'AbortError') setErr('Fetch failed');
        return;
      }
      if (!res.ok) { setErr(`HTTP ${res.status}`); return; }

      const reader = res.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          queue.push(value);
          pump();
        }
      } catch (e) {
        if (e.name !== 'AbortError') setErr('Stream ended');
      }
    }, { once: true });

    video.play().catch(() => {});

    return () => {
      abort.abort();
      URL.revokeObjectURL(srcUrl);
    };
  }, [camera.id]);

  return (
    <div
      style={{
        position: 'relative',
        background: '#000',
        borderRadius: 8,
        overflow: 'hidden',
        border: selected ? '2px solid var(--accent)' : '2px solid var(--border)',
        cursor: 'pointer',
        aspectRatio: fullscreen ? undefined : '16/9',
        height: fullscreen ? '100%' : undefined,
      }}
      onClick={() => onSelect(camera)}
    >
      {err ? (
        <div style={{ color: '#f66', fontSize: 12, padding: 16, textAlign: 'center', paddingTop: '20%' }}>{err}</div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
        />
      )}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '6px 10px',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
        fontSize: 12, fontWeight: 600, color: '#fff',
        pointerEvents: 'none',
      }}>
        {camera.name}
        <span style={{ marginLeft: 8, fontWeight: 400, opacity: 0.7, fontSize: 11 }}>{camera.ip}</span>
      </div>
    </div>
  );
}

function AddCameraModal({ onSave, onClose, existing }) {
  const [form, setForm] = useState(
    existing
      ? { name: existing.name, ip: existing.ip, user: existing.user, pass: '' }
      : { name: '', ip: '', user: 'admin', pass: '' }
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!form.name || !form.ip || !form.user || (!existing && !form.pass)) {
      setErr('All fields are required'); return;
    }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
        padding: 28, width: 380, maxWidth: '90vw',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>
          {existing ? 'Edit Camera' : 'Add Camera'}
        </div>
        <form onSubmit={submit}>
          {[
            { label: 'Name', key: 'name', placeholder: 'Front Door' },
            { label: 'IP Address', key: 'ip', placeholder: '192.168.1.101' },
            { label: 'Username', key: 'user', placeholder: 'admin' },
            { label: existing ? 'New Password (leave blank to keep)' : 'Password', key: 'pass', placeholder: '••••••••', type: 'password' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 5 }}>{f.label}</div>
              <input
                type={f.type || 'text'}
                value={form[f.key]}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--bg3)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '8px 10px',
                  color: 'var(--text)', fontSize: 13,
                }}
              />
            </div>
          ))}
          {err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const GRID_OPTIONS = [1, 2, 4, 6, 9];

export default function CCTV() {
  const [cameras, setCameras] = useState([]);
  const [tab, setTab] = useState('live');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'add' | camera-object (edit)
  const [selected, setSelected] = useState(null);
  const [gridCols, setGridCols] = useState(2);
  const [deleting, setDeleting] = useState(null);

  async function load() {
    try {
      const { data } = await getCameras();
      setCameras(data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(form) {
    const { data } = await addCamera(form);
    setCameras(p => [...p, data]);
  }

  async function handleEdit(form) {
    const { data } = await updateCamera(modal.id, form);
    setCameras(p => p.map(c => c.id === modal.id ? data : c));
  }

  async function handleDelete(cam) {
    setDeleting(cam.id);
    try {
      await deleteCamera(cam.id);
      setCameras(p => p.filter(c => c.id !== cam.id));
      if (selected?.id === cam.id) setSelected(null);
    } catch {}
    setDeleting(null);
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
    gap: 12,
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">CCTV</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {tab === 'live' && cameras.length > 0 && (
            <div style={{ display: 'flex', gap: 4 }}>
              {GRID_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => setGridCols(n === 1 ? 1 : Math.ceil(Math.sqrt(n)))}
                  className={gridCols === (n === 1 ? 1 : Math.ceil(Math.sqrt(n))) && (n === 1 ? true : n <= cameras.length) ? 'btn-primary' : 'btn-secondary'}
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  title={`${n}-up view`}
                >
                  {n === 1 ? '1×1' : n === 2 ? '1×2' : n === 4 ? '2×2' : n === 6 ? '2×3' : '3×3'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[{ key: 'live', label: 'Live View' }, { key: 'settings', label: 'Cameras' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 16px', background: 'transparent', fontSize: 13, fontWeight: 500,
            color: tab === t.key ? 'var(--text)' : 'var(--text2)',
            borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
            borderRadius: '6px 6px 0 0',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Live view */}
      {tab === 'live' && (
        <>
          {loading ? (
            <div className="loading-center"><span className="spinner" /> Loading cameras…</div>
          ) : cameras.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📷</div>
              <div style={{ color: 'var(--text2)', marginBottom: 16 }}>No cameras configured yet.</div>
              <button className="btn-primary" onClick={() => setTab('settings')}>Add Camera</button>
            </div>
          ) : selected ? (
            // Fullscreen single-camera view
            <div>
              <button className="btn-secondary" onClick={() => setSelected(null)} style={{ marginBottom: 12, fontSize: 12 }}>
                ← Back to grid
              </button>
              <div style={{ height: 'calc(100vh - 200px)', borderRadius: 8, overflow: 'hidden' }}>
                <CameraFeed camera={selected} onSelect={() => {}} selected fullscreen />
              </div>
            </div>
          ) : (
            <div style={gridStyle}>
              {cameras.map(cam => (
                <CameraFeed key={cam.id} camera={cam} onSelect={setSelected} selected={false} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Camera management */}
      {tab === 'settings' && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{cameras.length} camera{cameras.length !== 1 ? 's' : ''} configured</span>
            <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setModal('add')}>+ Add Camera</button>
          </div>

          {cameras.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)', fontSize: 13 }}>
              No cameras yet. Click "Add Camera" to get started.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>IP Address</th>
                  <th>Username</th>
                  <th>Stream ID</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cameras.map(cam => (
                  <tr key={cam.id}>
                    <td style={{ fontWeight: 500 }}>{cam.name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{cam.ip}</td>
                    <td style={{ color: 'var(--text2)' }}>{cam.user}</td>
                    <td><code style={{ color: 'var(--accent)', fontSize: 12 }}>{cam.id}</code></td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setModal(cam)}>
                          Edit
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11, padding: '3px 10px', color: 'var(--red)', borderColor: 'var(--red)' }}
                          disabled={deleting === cam.id}
                          onClick={() => {
                            if (window.confirm(`Delete camera "${cam.name}"?`)) handleDelete(cam);
                          }}
                        >
                          {deleting === cam.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)' }}>
            <strong style={{ color: 'var(--text)' }}>go2rtc setup:</strong>{' '}
            Install with <code>curl -fsSL https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64 -o /usr/local/bin/go2rtc && chmod +x /usr/local/bin/go2rtc</code>,
            then enable as a systemd service. Streams are served at <code>rtsp://localhost:8554/&lt;id&gt;</code>.
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {modal && (
        <AddCameraModal
          existing={modal === 'add' ? null : modal}
          onSave={modal === 'add' ? handleAdd : handleEdit}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
