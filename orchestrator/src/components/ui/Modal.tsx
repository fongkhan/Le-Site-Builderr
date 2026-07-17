import type { ReactNode } from 'react';

interface ModalProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number | string;
  footer?: ReactNode;
  bodyPadding?: boolean;
}

export function Modal({ title, subtitle, onClose, children, maxWidth = 600, footer, bodyPadding = true }: ModalProps) {
  return (
    <div className="modal-overlay animate-slide" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-panel modal-panel" style={{ maxWidth }}>
        <div className="modal-header">
          <div>
            <h3 style={{ fontSize: '1.2rem', color: 'white' }}>{title}</h3>
            {subtitle && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{subtitle}</span>}
          </div>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.85rem' }} onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="modal-body" style={bodyPadding ? undefined : { padding: 0 }}>
          {children}
        </div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
