type Tone = 'info' | 'warn' | 'error';

interface ErrorHintProps {
  message: string;
  action?: string;
  tone?: Tone;
}

const ICONS: Record<Tone, string> = {
  info: 'i',
  warn: '!',
  error: '!',
};

export default function ErrorHint({ message, action, tone = 'warn' }: ErrorHintProps) {
  return (
    <div className={`error-hint error-hint--${tone}`} role="status">
      <span className="error-hint__icon" aria-hidden>
        {ICONS[tone]}
      </span>
      <div className="error-hint__content">
        <p className="error-hint__message">{message}</p>
        {action && <p className="error-hint__action">{action}</p>}
      </div>
    </div>
  );
}