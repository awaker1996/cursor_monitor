interface ErrorHintProps {
  message: string;
  action?: string;
}

export default function ErrorHint({ message, action }: ErrorHintProps) {
  return (
    <div className="error-hint">
      <span className="error-hint__icon">!</span>
      <div className="error-hint__content">
        <p className="error-hint__message">{message}</p>
        {action && <p className="error-hint__action">{action}</p>}
      </div>
    </div>
  );
}
