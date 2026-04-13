import React, { useEffect, useState, useRef } from 'react';
import WanCard from '../components/WanCard.jsx';
import SysInfo from '../components/SysInfo.jsx';
import { getWanStatus, getWanPublicIp, getThroughputHistory } from '../api/index.js';

function ModeBar({ mode }) {
  return (
    <div className="mode-bar">
      <span style={{ fontSize: 12, color: 'var(--text2)', marginRight: 8 }}>Active Mode:</span>
      <span className={`mode-pill ${mode === 'ecmp'         ? 'active-ecmp'    : ''}`}>ECMP Load Balance</span>
      <span className={`mode-pill ${mode === 'zte-only'     ? 'active-zte'     : ''}`}>ZTE Only</span>
      <span className={`mode-pill ${mode === 'digisol-only' ? 'active-digisol' : ''}`}>DIGISOL Only</span>
    </div>
  );
}

function OverallBadge({ zte, digisol }) {
  if (!zte || !digisol) return null;
  const bothUp = zte.status === 'up' && digisol.status === 'up';
  const oneUp  = zte.status === 'up' || digisol.status === 'up';
  return bothUp
    ? <span className="badge badge-green"><span className="dot dot-green" /> ALL OK</span>
    : oneUp
      ? <span className="badge badge-yellow"><span className="dot dot-yellow" /> DEGRADED</span>
      : <span className="badge badge-red"><span className="dot dot-red" /> CRITICAL</span>;
}

export default function Dashboard() {
  const [status, setStatus] = useState(null);
  const [publicIps, setPublicIps] = useState({ zte: null, digisol: null });
  const [history, setHistory] = useState({ zte: [], digisol: [] });
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState('');
  const sseRef = useRef(null);

  async function fetchPublicIps() {
    try {
      const { data } = await getWanPublicIp();
      setPublicIps(data);
    } catch {}
  }

  async function fetchHistory() {
    try {
      const { data } = await getThroughputHistory(150);
      const zte     = data.map(d => ({ rxRate: d.zte?.rxRate,     txRate: d.zte?.txRate }));
      const digisol = data.map(d => ({ rxRate: d.digisol?.rxRate, txRate: d.digisol?.txRate }));
      setHistory({ zte, digisol });
    } catch {}
  }

  useEffect(() => {
    // Initial data
    getWanStatus().then(({ data }) => setStatus(data)).catch(e => setError(e.message));
    fetchPublicIps();
    fetchHistory();

    // SSE for live updates
    const token = localStorage.getItem('token');
    const evtSrc = new EventSource(`/api/stream/status?token=${token}`);
    sseRef.current = evtSrc;

    evtSrc.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        setLastUpdate(new Date().toLocaleTimeString());
        setStatus(prev => prev ? {
          ...prev,
          mode: d.mode,
          zte:     { ...prev.zte,     rxRate: d.zte?.rxRate,     txRate: d.zte?.txRate },
          digisol: { ...prev.digisol, rxRate: d.digisol?.rxRate, txRate: d.digisol?.txRate },
        } : prev);
        setHistory(prev => ({
          zte:     [...prev.zte.slice(-149),     { rxRate: d.zte?.rxRate,     txRate: d.zte?.txRate }],
          digisol: [...prev.digisol.slice(-149), { rxRate: d.digisol?.rxRate, txRate: d.digisol?.txRate }],
        }));
      } catch {}
    };
    evtSrc.onerror = () => {};

    // Poll public IPs every 60s
    const ipTimer = setInterval(fetchPublicIps, 60000);
    // Full status refresh every 30s
    const statusTimer = setInterval(() => {
      getWanStatus().then(({ data }) => setStatus(data)).catch(() => {});
    }, 30000);

    return () => {
      evtSrc.close();
      clearInterval(ipTimer);
      clearInterval(statusTimer);
    };
  }, []);

  if (error) return <div style={{ color: 'var(--red)', padding: 20 }}>{error}</div>;
  if (!status) return <div className="loading-center"><span className="spinner" /> Loading WAN status…</div>;

  const zteData     = { ...status.zte,     publicIp: publicIps.zte };
  const digisolData = { ...status.digisol, publicIp: publicIps.digisol };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          {lastUpdate && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>Last update: {lastUpdate}</div>}
        </div>
        <OverallBadge zte={status.zte} digisol={status.digisol} />
      </div>

      {/* Mode bar */}
      <div className="section-gap">
        <ModeBar mode={status.mode} />
      </div>

      {/* Hash policy info */}
      {status.hashPolicy != null && (
        <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text2)' }}>
          Hash Policy: <strong style={{ color: 'var(--text)' }}>{status.hashPolicy === 0 ? '0 — src+dst IP' : '1 — src+dst IP+Port'}</strong>
          <span style={{ marginLeft: 8, color: 'var(--text2)' }}>
            {status.hashPolicy === 0 ? '(Single connection hashes to one WAN — expected for speedtests)' : ''}
          </span>
        </div>
      )}

      {/* WAN Cards */}
      <div className="grid-2">
        <WanCard label="ZTE (WAN 1)"     isp="Netplus Broadband"  wan={zteData}     history={history.zte} />
        <WanCard label="DIGISOL (WAN 2)" isp="Falconet Internet"  wan={digisolData} history={history.digisol} />
      </div>

      {/* System Info */}
      <div className="section-gap" style={{ marginTop: 20 }}>
        <SysInfo />
      </div>
    </div>
  );
}
