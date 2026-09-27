import type { ComponentProps, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'light' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-200',
  secondary: 'border border-line bg-surface text-ink hover:bg-canvas disabled:text-ink-muted',
  light: 'bg-white text-brand-800 hover:bg-brand-50',
  danger: 'border border-danger-600 bg-surface text-danger-600 hover:bg-danger-50',
};

/** Tap targets are at least 48px high for thumbs on small phones. */
export function buttonClasses(variant: ButtonVariant = 'primary', extra = ''): string {
  return `inline-flex min-h-12 items-center justify-center gap-2 rounded-control px-5 font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return <button className={buttonClasses(variant, className)} {...props} />;
}

const fieldClasses =
  'block min-h-12 w-full rounded-control border border-line bg-surface px-4 text-base text-ink placeholder:text-ink-muted aria-invalid:border-danger-600';

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export function TextInput({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${fieldClasses} ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select className={`${fieldClasses} ${className}`} {...props} />;
}

export function Alert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const styles =
    tone === 'error' ? 'bg-danger-50 text-danger-600' : 'bg-success-50 text-success-700';
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-control px-4 py-3 ${styles}`}
    >
      {children}
    </p>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-surface p-5 ${className}`}>
      {children}
    </section>
  );
}
