import React, { useState, useEffect } from 'react';
import { getDhcpLeases, getDhcpReservations, addReservation, deleteReservation } from '../api/index.js';
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

const LABEL = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' };

export default function DhcpLeases() {
  const toast = useToast();
  const [data, setData]               = useState(null);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState('leases'); // 'leases' | 'reservations'
  const [showAdd, setShowAdd]         = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // mac string
  const [form, setForm]               = useState({ mac: '', ip: '', hostname: '' });
  const [saving, setSaving]           = useState(false);
  const [filter, setFilter]           = useState('');

  async function load() {
    setLoading(true);
    try {
      const [leasesRes, resRes] = await Promise.all([
        getDhcpLeases(),
        getDhcpReservations(),
      ]);
      setData(leasesRes.data);
      setReservations(resRes.data || []);
    } catch {
      toast('Failed to load DHCP data', 'error');
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
  const filteredLeases = filter
    ? leases.filter(l =>
        l.ip.includes(filter) ||
        l.mac.includes(filter.toLowerCase()) ||
        (l.hostname || '').toLowerCase().includes(filter.toLowerCase()))
    : leases;

  const filteredRes = filter
    ? reservations.filter(r =>
        r.ip?.includes(filter) ||
        r.mac?.includes(filter.toLowerCase()) ||
        (r.hostname || '').toLowerCase().includes(filter.toLowerCase()))
    : reservations;

  const poolPct = data ? Math.round((data.poolUsed / data.poolSize) * 100) : 0;

  // Find which reservations currently have an active lease
  const activeMacs = new Set(leases.filter(l => l.status === 'active').map(l => l.mac));

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
            <span style={{ color: 'var(--text2)' }}>Pool Usage — 192.168.1.100–200</span>
            <span><strong>{data.poolUsed}</strong> / {data.poolSize} active ({poolPct}%)</span>
          </div>
          <div style={{ height: 8, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${poolPct}%`,
              background: poolPct > 80 ? 'var(--red)' : poolPct > 60 ? 'var(--yellow)' : 'var(--green)',
              borderRadius: 4, transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 12, color: 'var(--text2)' }}>
            <span>Total leases: <strong style={{ color: 'var(--text)' }}>{leases.length}</strong></span>
            <span>Active: <strong style={{ color: 'var(--green)' }}>{data.poolUsed}</strong></span>
            <span>Reservations: <strong style={{ color: 'var(--accent2)' }}>{reservations.length}</strong></span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'leases',       label: `Active Leases (${leases.length})` },
          { key: 'reservations', label: `Reserved IPs (${reservations.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFilter(''); }}
            style={{
              padding: '8px 18px', background: 'transparent', fontSize: 13, fontWeight: 500,
              color: tab === t.key ? 'var(--text)' : 'var(--text2)',
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: '6px 6px 0 0',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter */}
      <div style={{ marginBottom: 14 }}>
        <input
          placeholder="Filter by IP, MAC, or hostname…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ maxWidth: 300 }}
        />
      </div>

      {/* ── Leases table ── */}
      {tab === 'leases' && (
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
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeases.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text2)', padding: 24 }}>No leases found</td></tr>
                  ) : filteredLeases.map((l, i) => (
                    <tr key={i}>
                      <td><code style={{ color: 'var(--accent)' }}>{l.ip}</code></td>
                      <td><code style={{ fontSize: 11 }}>{l.mac}</code></td>
                      <td>{l.hostname || <span style={{ color: 'var(--text2)' }}>—</span>}</td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>{formatExpiry(l.end)}</td>
                      <td><StatusBadge status={l.status} /></td>
                      <td>
                        {l.isStatic
                          ? <span className="badge badge-blue">Reserved</span>
                          : <span style={{ color: 'var(--text2)', fontSize: 12 }}>Dynamic</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Reservations table ── */}
      {tab === 'reservations' && (
        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-center"><span className="spinner" /> Loading…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reserved IP</th>
                    <th>MAC Address</th>
                    <th>Hostname</th>
                    <th>Lease Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRes.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text2)', padding: 32 }}>
                        No reservations configured.{' '}
                        <button
                          onClick={() => setShowAdd(true)}
                          style={{ background: 'none', color: 'var(--accent2)', padding: 0, fontSize: 13 }}
                        >
                          Add one →
                        </button>
                      </td>
                    </tr>
                  ) : filteredRes.map((r, i) => {
                    const hasLease = activeMacs.has(r.mac);
                    return (
                      <tr key={i}>
                        <td><code style={{ color: 'var(--accent)' }}>{r.ip}</code></td>
                        <td><code style={{ fontSize: 11 }}>{r.mac}</code></td>
                        <td>{r.hostname || <span style={{ color: 'var(--text2)' }}>—</span>}</td>
                        <td>
                          {hasLease
                            ? <span className="badge badge-green"><span className="dot dot-green" /> Online</span>
                            : <span className="badge badge-gray">Not seen</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn-danger"
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            onClick={() => setDeleteTarget(r.mac)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!loading && reservations.length > 0 && (
            <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--border)' }}>
              {reservations.length} reservation{reservations.length !== 1 ? 's' : ''} — changes restart DHCP automatically
            </div>
          )}
        </div>
      )}

      {/* ── Add Reservation Modal ── */}
      {showAdd && (
        <div style={styles.overlay} onClick={() => setShowAdd(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 20, fontSize: 16 }}>Add Static Reservation</h3>
            <form onSubmit={handleAdd}>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>MAC Address</label>
                <input
                  placeholder="aa:bb:cc:dd:ee:ff"
                  value={form.mac}
                  onChange={e => setForm(f => ({ ...f, mac: e.target.value }))}
                  required
                  pattern="^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$"
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Reserved IP Address</label>
                <input
                  placeholder="192.168.1.X"
                  value={form.ip}
                  onChange={e => setForm(f => ({ ...f, ip: e.target.value }))}
                  required
                />
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                  Pool: 192.168.1.100–200 · Gateway: 192.168.1.254
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={LABEL}>Hostname (optional)</label>
                <input
                  placeholder="my-device"
                  value={form.hostname}
                  onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))}
                />
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
        message={`Remove static reservation for ${deleteTarget}? The device will receive a dynamic IP on next lease renewal.`}
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
  modal: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '28px 32px', width: 420 },
};
