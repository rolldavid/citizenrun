import { useState } from 'react';

import { useIssuesEditor } from '@/features/onboarding';

import type { SettingsIssuesViewModel } from './settings-issues.types';

/** SCR-settings-issues: the issues step's editor; 'saved' until the next save (E-ME-09). */
export function useSettingsIssuesViewModel(): SettingsIssuesViewModel {
  const [saved, setSaved] = useState(false);
  const editor = useIssuesEditor({
    onSaved: () => {
      setSaved(true);
    },
    backTo: '/settings',
  });
  if (editor.status !== 'ready') {
    return editor;
  }
  const { submit, onContinue, ...rest } = editor.data;
  return {
    ...editor,
    data: {
      ...rest,
      submit: saved ? { status: 'saved', errorCode: null } : submit,
      onContinue: (picked) => {
        setSaved(false);
        onContinue(picked);
      },
    },
  };
}
