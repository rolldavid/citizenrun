import type { JSX, ReactNode } from 'react';

import { FieldShell } from './field-shell';

export { useFieldA11y } from './field-shell';

export type FormFieldProps = {
  label: string;
  /** Keeps the label for screen readers and drops it from the layout. */
  labelHidden?: boolean;
  helper?: string;
  status?: 'none' | 'error' | 'valid';
  /** The sentence of an error or a valid state; it takes the helper's place. */
  statusText?: string;
  children: ReactNode;
};

/**
 * C-FormField: the label, the helper line and the status line around one control. The fields of
 * the design system draw it themselves; a feature uses it only around a control of its own, which
 * reads its name and its description with `useFieldA11y`.
 */
export function FormField({
  label,
  labelHidden = false,
  helper,
  status = 'none',
  statusText,
  children,
}: FormFieldProps): JSX.Element {
  return (
    <FieldShell
      label={label}
      labelHidden={labelHidden}
      status={status}
      announce="alert"
      {...(helper === undefined ? {} : { helper })}
      {...(statusText === undefined ? {} : { statusText })}
    >
      {children}
    </FieldShell>
  );
}
