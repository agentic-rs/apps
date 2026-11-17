import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function ScreenHeader({
  title,
  subtitle,
  back_label,
  onBack,
  action,
  locked,
}: {
  title: string;
  subtitle?: string;
  back_label?: string;
  onBack?: () => void;
  action?: ReactNode;
  locked: boolean;
}) {
  return (
    <header className="navigation-bar">
      {onBack ? (
        <button
          className="nav-back"
          aria-label={back_label ?? 'Back'}
          disabled={locked}
          onClick={onBack}
        >
          <Icon name="back" size={23} />
          <span>{back_label ?? 'Back'}</span>
        </button>
      ) : (
        <span className="nav-spacer" />
      )}
      <div className="navigation-title">
        <h1 title={title}>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="nav-action">{action}</div>
    </header>
  );
}
