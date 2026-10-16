export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="form-error-banner" role="alert">
      {message}
    </div>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="form-success-banner" role="status">
      {message}
    </div>
  );
}
