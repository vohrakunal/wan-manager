import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const show = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const dismiss = useCallback(id => setToasts(prev => prev.filter(t => t.id !== id)), []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div style={styles.container}>
        {toasts.map(t => (
          <div key={t.id} style={{ ...styles.toast, ...styles[t.type] }} onClick={() => dismiss(t.id)}>
            <span style={styles.icon}>{icons[t.type]}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

const styles = {
  container: {
    position: 'fixed', bottom: 24, right: 24,
    display: 'flex', flexDirection: 'column', gap: 8,
    zIndex: 9999, maxWidth: 360,
  },
  toast: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 16px', borderRadius: 8,
    fontSize: 13, fontWeight: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    cursor: 'pointer', animation: 'fadeIn 0.2s ease',
    color: '#fff',
  },
  icon: { fontWeight: 700, fontSize: 14 },
  success: { background: '#1a4731', border: '1px solid #3fb950' },
  error:   { background: '#4a1a1a', border: '1px solid #f85149' },
  warning: { background: '#3d2d00', border: '1px solid #d29922' },
  info:    { background: '#0d2a4a', border: '1px solid #2f81f7' },
};
