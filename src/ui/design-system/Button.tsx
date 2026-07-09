import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';
const styles: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-cyan to-cyan-deep text-[#032430]',
  ghost: 'bg-surface text-[color:var(--text)] border border-[color:var(--border)]',
  danger: 'bg-danger text-[#2a0a0a]',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-2xl px-5 py-3 font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
