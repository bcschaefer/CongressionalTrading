// Thin red-to-blue accent line — the same gradient as the top nav strip, reused as a
// section separator so it reads as one consistent site accent rather than a one-off.
export default function GradientRule({ className = '' }: { className?: string }) {
  return <div className={`h-[3px] w-full shrink-0 bg-linear-to-r from-(--color-negative) to-(--color-accent) ${className}`} />;
}
