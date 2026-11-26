import type { Issue } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { IssueGrid } from '@/ui/components/issue-grid';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { issueShortName } from './issue-short-name';
import { STEP_NAMESPACES } from './step-translation';

export type IssuesControlProps = {
  /** Every issue, in the order it is shown. */
  issues: readonly Issue[];
  /** The grid's accessible name: the text of the screen's heading. */
  label: string;
  picked: readonly string[];
  starred: readonly string[];
  limits: { max: number; maxStarred: number };
  onToggle: (issueId: string) => void;
  onToggleStar: (issueId: string) => void;
  onLimit: (limit: 'selected' | 'starred') => void;
  testID: string;
};

const PRIVACY: ViewStyle = { marginTop: space.x4 };

/**
 * The issues as a grid of chips, each printed with its short name and named in full to a screen
 * reader, and under it the line that says who sees the picks (CTL-77).
 */
export function IssuesControl({
  issues,
  label,
  picked,
  starred,
  limits,
  onToggle,
  onToggleStar,
  onLimit,
  testID,
}: IssuesControlProps): JSX.Element {
  const { t } = useTranslation(STEP_NAMESPACES);
  return (
    <View>
      <IssueGrid
        issues={issues.map((issue) => ({
          id: issue.id,
          name: issueShortName(issue, t),
          label: issue.name,
        }))}
        label={label}
        selectedIds={picked}
        starredIds={starred}
        maxSelected={limits.max}
        maxStarred={limits.maxStarred}
        onToggle={onToggle}
        onToggleStar={onToggleStar}
        onLimit={onLimit}
        testID={testID}
      />
      <View style={PRIVACY}>
        <Text role="caption" tone="secondary">
          {t('onboarding:issues.privacy')}
        </Text>
      </View>
    </View>
  );
}
