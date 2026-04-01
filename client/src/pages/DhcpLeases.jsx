import React, { useState, useEffect } from 'react';
import { getDhcpLeases, addReservation, deleteReservation, restartDhcp } from '../api/index.js';
import { useToast } from '../components/Toast.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

function formatExpiry(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }) {
  const map = { active: 'badge-green', expired: 'badge-red', free: 'badge-gray' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}

export default function DhcpLeases() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({ mac: '', ip: '', hostname: '' });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data: d } = await getDhcpLeases();
      setData(d);
    } catch {
      toast('Failed to load DHCP leases', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await addReservation(form);
      toast(`Reservation added for ${form.mac}`, 'success');
      setShowAdd(false);
      setForm({ mac: '', ip: '', hostname: '' });
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add reservation', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const mac = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteReservation(mac);
      toast(`Reservation removed for ${mac}`, 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to remove reservation', 'error');
    }
  }

  const leases = data?.leases || [];
  const filtered = filter
    ? leases.filter(l =>
        l.ip.includes(filter) ||
        l.mac.includes(filter.toLowerCase()) ||
        (l.hostname || '').toLowerCase().includes(filter.toLowerCase()))
    : leases;

  const poolPct = data ? Math.round((data.poolUsed / data.poolSize) * 100) : 0;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">DHCP Leases</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add Reservation</button>
          <button className="btn-secondary" onClick={load} disabled={loading}>↺ Refresh</button>
        </div>
      </div>

      {/* Pool usage */}
      {data && (
        <div className="card section-gap">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--text2)' }}>Pool Usage</span>
            <span><strong>{data.poolUsed}</strong> / {data.poolSize} ({poolPct}%)</span>
          </div>
          <div style={{ height: 8, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${poolPct}%`, background: poolPct > 80 ? 'var(--red)' : poolPct > 60 ? 'var(--yellow)' : 'var(--green)', borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ marginBottom: 14 }}>
        <input
          placeholder="Filter by IP, MAC, or hostname…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ maxWidth: 300 }}
        />
      </div>

      {/* Leases table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><span className="spinner" /> Loading…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>IP Address</th>
                  <th>MAC Address</th>
                  <th>Hostname</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Static</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text2)', padding: 24 }}>No leases found</td></tr>
                ) : filtered.map((l, i) => (
                  <tr key={i}>
                    <td><code style={{ color: 'var(--accent)' }}>{l.ip}</code></td>
                    <td><code style={{ fontSize: 11 }}>{l.mac}</code></td>
                    <td>{l.hostname || <span style={{ color: 'var(--text2)' }}>—</span>}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{formatExpiry(l.end)}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td>{l.isStatic ? <span className="badge badge-blue">Static</span> : <span style={{ color: 'var(--text2)', fontSize: 12 }}>Dynamic</span>}</td>
                    <td>
                      {l.isStatic && (
                        <button
                          className="btn-danger"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => setDeleteTarget(l.mac)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Reservation Modal */}
      {showAdd && (
        <div style={styles.overlay} onClick={() => setShowAdd(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 20, fontSize: 16 }}>Add Static Reservation</h3>
            <form onSubmit={handleAdd}>
              <div style={{ marginBottom: 14 }}>
                <label style={styles.label}>MAC Address</label>
                <input placeholder="aa:bb:cc:dd:ee:ff" value={form.mac} onChange={e => setForm(f => ({ ...f, mac: e.target.value }))} required pattern="^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={styles.label}>IP Address</label>
                <input placeholder="192.168.1.X" value={form.ip} onChange={e => setForm(f => ({ ...f, ip: e.target.value }))} required />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={styles.label}>Hostname (optional)</label>
                <input placeholder="my-device" value={form.hostname} onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : 'Add Reservation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Remove Reservation"
        message={`Remove static reservation for ${deleteTarget}? The device will get a dynamic IP on next lease.`}
        confirmLabel="Remove"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '28px 32px', width: 400 },
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' },
};
