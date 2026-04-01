import React, { useState, useEffect } from 'react';
import { getAllRoutes, getRoutingRules, fixRoutes } from '../api/index.js';
import { useToast } from '../components/Toast.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

const TABS = ['default', 'main', 'zte', 'digisol', 'rules'];

function colorizeRoute(line) {
  if (line.includes('nexthop') && (line.includes('eno1') || line.includes('enx207bd51a8b0b'))) {
    return <span style={{ color: 'var(--green)' }}>{line}</span>;
  }
  if (line.includes('via') && !line.includes('nexthop')) {
    return <span style={{ color: 'var(--yellow)' }}>{line}</span>;
  }
  return line;
}

function colorizeRule(line, duplicates = []) {
  const isDup = duplicates.some(ip => line.includes(ip));
  if (isDup) return <span style={{ color: 'var(--red)', fontWeight: 600 }}>{line} ⚠ DUPLICATE</span>;
  return line;
}

export default function RoutingTables() {
  const toast = useToast();
  const [data, setData] = useState({});
  const [rulesInfo, setRulesInfo] = useState({ duplicates: [], totalRules: 0 });
  const [activeTab, setActiveTab] = useState('default');
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [allRes, rulesRes] = await Promise.all([getAllRoutes(), getRoutingRules()]);
      setData(allRes.data);
      setRulesInfo({ duplicates: rulesRes.data.duplicates, totalRules: rulesRes.data.totalRules });
    } catch (err) {
      toast('Failed to load routing tables', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleFix() {
    setShowConfirm(false);
    setFixing(true);
    try {
      await fixRoutes();
      toast('Routing rules fixed successfully', 'success');
      await load();
    } catch (err) {
      toast('Fix failed: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setFixing(false);
    }
  }

  const content = data[activeTab] || '';
  const lines = content.split('\n').filter(Boolean);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Routing Tables</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {rulesInfo.duplicates.length > 0 && (
            <button className="btn-danger" onClick={() => setShowConfirm(true)} disabled={fixing}>
              {fixing ? <span className="spinner" /> : '⚠ Fix Duplicates'}
            </button>
          )}
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" /> : '↺ Refresh'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(tab => {
          const isRules = tab === 'rules';
          const hasDups = isRules && rulesInfo.duplicates.length > 0;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 16px', borderRadius: '6px 6px 0 0', fontSize: 13, fontWeight: 500,
                background: activeTab === tab ? 'var(--bg2)' : 'transparent',
                color: activeTab === tab ? 'var(--text)' : 'var(--text2)',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {isRules && (
                <span style={{
                  background: hasDups ? 'var(--red)' : 'var(--bg3)',
                  color: hasDups ? '#fff' : 'var(--text2)',
                  fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700,
                }}>
                  {rulesInfo.totalRules}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table content */}
      <div className="card">
        {loading ? (
          <div className="loading-center"><span className="spinner" /> Loading…</div>
        ) : (
          <div className="code-block" style={{ maxHeight: 480 }}>
            {lines.length === 0
              ? <span style={{ color: 'var(--text2)' }}>(empty)</span>
              : lines.map((line, i) => (
                  <div key={i}>
                    {activeTab === 'rules'
                      ? colorizeRule(line, rulesInfo.duplicates)
                      : colorizeRoute(line)}
                  </div>
                ))
            }
          </div>
        )}
      </div>

      {rulesInfo.duplicates.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
          ⚠ Duplicate rules detected for: {rulesInfo.duplicates.join(', ')} — use "Fix Duplicates" to clean up.
        </div>
      )}

      <ConfirmModal
        open={showConfirm}
        title="Fix Duplicate Rules"
        message="This will flush all policy rules and re-add the correct ones. Active connections may be briefly interrupted."
        confirmLabel="Fix Now"
        danger
        onConfirm={handleFix}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
