import React, { useState, useEffect } from 'react';
import ConfirmModal from '../components/ConfirmModal.jsx';
import { useToast } from '../components/Toast.jsx';
import { setECMP, setZteOnly, setDigisolOnly, runSetup, setHashPolicy, restartService, getWanStatus } from '../api/index.js';

const ACTIONS = [
  { key: 'ecmp',         label: 'ECMP Load Balance', color: 'var(--accent)',  fn: setECMP,        mode: 'ecmp',         desc: 'Distribute traffic across both WANs using ECMP.' },
  { key: 'zte-only',     label: 'ZTE Only',           color: 'var(--green)',  fn: setZteOnly,     mode: 'zte-only',     desc: 'Route ALL traffic through ZTE (WAN 1 — Netplus).' },
  { key: 'digisol-only', label: 'DIGISOL Only',       color: 'var(--yellow)', fn: setDigisolOnly, mode: 'digisol-only', desc: 'Route ALL traffic through DIGISOL (WAN 2 — Falconet).' },
];

const SERVICES = [
  { key: 'wan-routes', label: 'WAN Routes Service', icon: '🔀' },
  { key: 'dhcp',       label: 'DHCP Server',        icon: '🖥️' },
];

function OutputBox({ output }) {
  if (!output) return null;
  return (
    <div className="code-block" style={{ marginTop: 12, maxHeight: 200 }}>
      {output || '(no output)'}
    </div>
  );
}

export default function Failover() {
  const toast = useToast();
  const [currentMode, setCurrentMode] = useState('');
  const [hashPolicy, setHash] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [loading, setLoading] = useState('');
  const [output, setOutput] = useState('');

  useEffect(() => {
    getWanStatus().then(({ data }) => {
      setCurrentMode(data.mode);
      setHash(data.hashPolicy);
    }).catch(() => {});
  }, []);

  async function execute(fn, label) {
    setLoading(label);
    setOutput('');
    try {
      const { data } = await fn();
      setOutput(data.output || 'Done.');
      toast(`${label} applied successfully`, 'success');
      // Refresh mode
      const s = await getWanStatus();
      setCurrentMode(s.data.mode);
      setHash(s.data.hashPolicy);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setOutput('Error: ' + msg);
      toast(`${label} failed: ${msg}`, 'error');
    } finally {
      setLoading('');
    }
  }

  async function handleHashToggle() {
    const next = hashPolicy === 0 ? 1 : 0;
    setLoading('hash');
    try {
      await setHashPolicy(next);
      setHash(next);
      toast(`Hash policy set to ${next}`, 'success');
    } catch (err) {
      toast('Failed to set hash policy', 'error');
    } finally {
      setLoading('');
    }
  }

  async function handleRestartService(svc) {
    setLoading('svc-' + svc.key);
    try {
      const { data } = await restartService(svc.key);
      setOutput(data.output || 'Service restarted.');
      toast(`${svc.label} restarted`, 'success');
    } catch (err) {
      toast(`Failed to restart ${svc.label}`, 'error');
    } finally {
      setLoading('');
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Failover Controls</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          Current mode: <strong style={{ color: 'var(--text)' }}>{currentMode || '…'}</strong>
        </div>
      </div>

      {/* Routing Mode */}
      <div className="card section-gap">
        <div className="card-title">Routing Mode</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {ACTIONS.map(a => {
            const isActive = currentMode === a.mode;
            return (
              <div key={a.key} style={{ flex: '1 1 160px' }}>
                <button
                  disabled={isActive || !!loading}
                  onClick={() => setConfirm(a)}
                  style={{
                    width: '100%', padding: '16px', fontSize: 14, fontWeight: 700,
                    background: isActive ? a.color : 'var(--bg3)',
                    color: isActive ? '#fff' : 'var(--text2)',
                    border: `2px solid ${isActive ? a.color : 'var(--border)'}`,
                    borderRadius: 8, lineHeight: 1.4,
                  }}
                >
                  {loading === a.label ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : a.label}
                  {isActive && <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>ACTIVE</div>}
                </button>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, textAlign: 'center' }}>{a.desc}</div>
              </div>
            );
          })}
        </div>
        <OutputBox output={output} />
      </div>

      {/* Hash Policy */}
      <div className="card section-gap">
        <div className="card-title">ECMP Hash Policy</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              Policy {hashPolicy ?? '…'}: <span style={{ color: 'var(--accent)' }}>
                {hashPolicy === 0 ? 'src+dst IP only' : hashPolicy === 1 ? 'src+dst IP + Port' : '—'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 420 }}>
              Policy 0: same source/dest always uses one WAN (speedtest shows one link).
              Policy 1: includes ports — better traffic distribution across WANs.
            </div>
          </div>
          <button
            className="btn-secondary"
            onClick={handleHashToggle}
            disabled={hashPolicy == null || loading === 'hash'}
            style={{ whiteSpace: 'nowrap' }}
          >
            {loading === 'hash' ? <span className="spinner" /> : `Switch to Policy ${hashPolicy === 0 ? 1 : 0}`}
          </button>
        </div>
      </div>

      {/* Run Setup */}
      <div className="card section-gap">
        <div className="card-title">Run WAN Setup Script</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, fontSize: 13, color: 'var(--text2)' }}>
            Executes <code style={{ background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4 }}>/usr/local/bin/wan-setup.sh</code> — re-configures routing tables, policy rules, and ECMP.
          </div>
          <button
            className="btn-secondary"
            onClick={() => setConfirm({ key: 'setup', label: 'Run wan-setup.sh', fn: runSetup })}
            disabled={!!loading}
          >
            {loading === 'Run wan-setup.sh' ? <span className="spinner" /> : '▶ Run Setup'}
          </button>
        </div>
        <OutputBox output={loading === '' && output && output.includes('setup') ? output : ''} />
      </div>

      {/* Restart Services */}
      <div className="card section-gap">
        <div className="card-title">Restart Services</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {SERVICES.map(svc => (
            <button
              key={svc.key}
              className="btn-secondary"
              disabled={!!loading}
              onClick={() => setConfirm({ key: 'svc-' + svc.key, label: `Restart ${svc.label}`, fn: () => handleRestartService(svc), noFn: true })}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {svc.icon} {loading === 'svc-' + svc.key ? <span className="spinner" /> : `Restart ${svc.label}`}
            </button>
          ))}
        </div>
      </div>

      {/* Confirm Modal */}
      <ConfirmModal
        open={!!confirm}
        title={`Confirm: ${confirm?.label}`}
        message={`${confirm?.desc || `This will execute: ${confirm?.label}. Are you sure?`}`}
        confirmLabel="Yes, proceed"
        danger={confirm?.key !== 'hash'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const a = confirm;
          setConfirm(null);
          if (!a.noFn) execute(a.fn, a.label);
        }}
      />
    </div>
  );
}
