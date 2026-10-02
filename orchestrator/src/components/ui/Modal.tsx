import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number | string;
  footer?: ReactNode;
  bodyPadding?: boolean;
  /** false : Escape, clic à l'extérieur et bouton Fermer sont sans effet (opération en cours) */
  dismissible?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Pile des modales ouvertes : seule celle du sommet réagit au clavier (Escape, Tab).
// Une confirmation ouverte depuis une autre modale ne ferme donc pas sa parente.
const modalStack: symbol[] = [];

// Modale rendue dans <body> (portail) : jamais confinée par un ancêtre transformé ou
// flouté, quelle que soit la page qui l'ouvre.
export function Modal({ title, subtitle, onClose, children, maxWidth = 600, footer, bodyPadding = true, dismissible = true }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // onClose/dismissible via ref : l'effet du piège de focus ne se réarme pas à chaque
  // rendu (sinon re-focus intempestif). Synchronisés hors rendu.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  }, [onClose, dismissible]);

  useEffect(() => {
    const token = Symbol('modal');
    modalStack.push(token);
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () => {
      const panel = panelRef.current;
      return panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
        : [];
    };

    // Focus initial : premier élément focusable, sinon le panneau lui-même
    (focusables()[0] ?? panelRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (dismissibleRef.current) onCloseRef.current();
        return;
      }
      if (e.key === 'Tab') {
        const els = focusables();
        if (els.length === 0) {
          e.preventDefault();
          return;
        }
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const idx = modalStack.lastIndexOf(token);
      if (idx !== -1) modalStack.splice(idx, 1);
      // Restitue le focus au déclencheur à la fermeture
      previouslyFocused?.focus?.();
    };
  }, []);

  const close = () => {
    if (dismissible) onClose();
  };

  return createPortal(
    <div className="modal-overlay animate-slide" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        ref={panelRef}
        className="glass-panel modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ maxWidth }}
      >
        <div className="modal-header">
          <div>
            <h3 id={titleId} style={{ fontSize: '1.2rem', color: 'white' }}>{title}</h3>
            {subtitle && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{subtitle}</span>}
          </div>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.85rem' }} onClick={close} disabled={!dismissible} aria-label="Fermer">
            Fermer
          </button>
        </div>
        <div className="modal-body" style={bodyPadding ? undefined : { padding: 0 }}>
          {children}
        </div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
