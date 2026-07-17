import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state animate-slide">
      <span style={{ fontSize: '2.5rem' }}>{icon}</span>
      <h3 style={{ fontSize: '1.15rem' }}>{title}</h3>
      {description && <p style={{ color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto' }}>{description}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
