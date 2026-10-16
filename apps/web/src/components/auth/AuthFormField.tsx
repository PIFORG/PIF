'use client';

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type FieldBase = {
  label: string;
  error?: string;
  hint?: string;
  id?: string;
};

type InputProps = FieldBase &
  InputHTMLAttributes<HTMLInputElement> & {
    as?: 'input';
  };

type SelectProps = FieldBase &
  SelectHTMLAttributes<HTMLSelectElement> & {
    as: 'select';
    children: ReactNode;
  };

type AuthFormFieldProps = InputProps | SelectProps;

export function AuthFormField(props: AuthFormFieldProps) {
  const { label, error, hint, id: idProp, as = 'input', ...rest } = props;
  const id =
    idProp ||
    ('name' in rest && typeof rest.name === 'string' && rest.name
      ? String(rest.name)
      : `field-${label.replace(/\s+/g, '-').toLowerCase()}`);
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {as === 'select' ? (
        <select
          id={id}
          className="select"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...(rest as SelectHTMLAttributes<HTMLSelectElement>)}
        >
          {(props as SelectProps).children}
        </select>
      ) : (
        <input
          id={id}
          className="input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      {hint ? (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
