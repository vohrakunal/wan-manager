import React from 'react';

export default function ConfirmModal({ open, title, message, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false }) {
  if (!open) return null;
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={styles.title}>{title}</h3>
        <p style={styles.msg}>{message}</p>
        <div style={styles.actions}>
          <button className="btn-secondary" style={{ padding: '8px 20px' }} onClick={onCancel}>Cancel</button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            style={{ padding: '8px 20px' }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '28px 32px',
    maxWidth: 420, width: '90%',
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text)' },
  msg:   { fontSize: 13, color: 'var(--text2)', marginBottom: 24, lineHeight: 1.6 },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
};
