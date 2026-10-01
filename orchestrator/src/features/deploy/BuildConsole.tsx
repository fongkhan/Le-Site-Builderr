import { useEffect, useRef } from 'react';

// Console des logs de build. Défile automatiquement vers la fin SEULEMENT si
// l'utilisateur y était déjà (pas de détournement du défilement de la page).
export function BuildConsole({ logs }: { logs: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div
      ref={ref}
      className="terminal"
      role="log"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {logs || 'Console initialisée. En attente de build…'}
    </div>
  );
}
