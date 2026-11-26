import type { ErrorCode } from '@citizenrun/shared';
import type { TFunction } from 'i18next';
import { Children } from 'react';
import type { JSX, ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { AgreementsViewModel } from '@/features/system/view-models/agreements.types';
import { useAgreementsViewModel } from '@/features/system/view-models/use-agreements-view-model';
import { Button } from '@/ui/components/button';
import { Link } from '@/ui/components/link';
import { Notice } from '@/ui/components/notice';
import { Sheet } from '@/ui/components/sheet';
import { Text } from '@/ui/components/text';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { space } from '@/ui/tokens';
import type { TypeRole } from '@/ui/typography';

const AGREEMENTS_NAMESPACES = ['system', 'common', 'errors'] as const;

type AgreementsT = TFunction<typeof AGREEMENTS_NAMESPACES>;

const OUTSIDE = 'https://';

// Words, not a control: the focus they hold draws no ring.
const WORDS: ViewStyle = { outlineStyle: 'solid', outlineWidth: 0 };
const LEAVE: ViewStyle = { marginTop: space.x3 };
// The sheet leaves `space.x4` over its foot on a phone and `space.x6` in its dialog form. The way
// out keeps `space.x6` clear of what stands under it in both.
const LEAVE_COMPACT: ViewStyle = { ...LEAVE, marginBottom: space.x6 - space.x4 };
const NOTICE: ViewStyle = { marginBottom: space.x3 };

/** The sheet is answered, never closed. */
function stay(): void {
  // nothing to do
}

/** The words a translated tag holds. */
function wordsOf(children: ReactNode): string {
  return Children.toArray(children)
    .filter((child) => typeof child === 'string')
    .join('');
}

type SentenceLinkProps = {
  href: string;
  /** True: a document on the public site. False: a path inside the app. */
  external: boolean;
  role: TypeRole;
  testID: string;
  /** The words between the tags of the sentence, placed by the translation. */
  children?: ReactNode;
};

/**
 * One linked word of a sentence. A document is a link only at an address that is safe to open
 * outside the app; at any other it is the same words as plain text, in the sentence's own tone.
 */
function SentenceLink({ href, external, role, testID, children }: SentenceLinkProps): JSX.Element {
  const words = wordsOf(children);
  if (external && !href.startsWith(OUTSIDE)) {
    return <Text role={role}>{words}</Text>;
  }
  return (
    <Link href={href} external={external} label={words} testID={testID}>
      <Text role={role} tone="primary">
        {words}
      </Text>
    </Link>
  );
}

/**
 * The sentence of a refusal. A refusal with no code, and the one code whose sentence holds a date
 * this sheet does not have, read the generic sentence.
 */
function errorText(code: ErrorCode | null, t: AgreementsT): string {
  return code === null || code === 'handle_change_too_soon'
    ? t('errors:generic')
    : t(`errors:${code}`);
}

/**
 * SCR-system-agreements: a document changed, and the person agrees with one tap or leaves with
 * their account's deletion (D-351, D-464, CTL-77). Nothing is ticked for them, and the sheet has
 * no way to close but its answer. A change to the privacy policy alone is told, not agreed to.
 */
export function AgreementsScreenView({ vm }: { vm: AgreementsViewModel }): JSX.Element {
  const { t } = useTranslation(AGREEMENTS_NAMESPACES);
  const { breakpoint } = useBreakpoint();
  const privacyOnly =
    vm.needed.length > 0 && vm.needed.every((document) => document === 'privacy_policy');
  const privacy = (
    <SentenceLink
      href={vm.links.privacyPolicy}
      external={true}
      role="body"
      testID="system.agreements-privacy"
    />
  );

  return (
    <Sheet
      open={true}
      onClose={stay}
      dismissible={false}
      title={privacyOnly ? t('system:agreements.privacyTitle') : t('system:agreements.title')}
      footer={
        <>
          {vm.status === 'error' ? (
            <View style={NOTICE}>
              <Notice kind="error" text={errorText(vm.errorCode, t)} />
            </View>
          ) : null}
          <Button
            variant="primary"
            fullWidth={true}
            label={privacyOnly ? t('common:ok') : t('system:agreements.agree')}
            busy={vm.status === 'saving'}
            onPress={vm.onAgree}
            testID="system.agreements-agree"
          />
        </>
      }
      testID="system.agreements"
    >
      {/* The words take the focus a sheet gives its first control, so no link is entered by chance. */}
      <View tabIndex={-1} style={WORDS}>
        <Text role="body">
          {privacyOnly ? (
            <Trans t={t} i18nKey="system:agreements.privacyBody" components={{ privacy }} />
          ) : (
            <Trans
              t={t}
              i18nKey="system:agreements.body"
              components={{
                terms: (
                  <SentenceLink
                    href={vm.links.terms}
                    external={true}
                    role="body"
                    testID="system.agreements-terms"
                  />
                ),
                policy: (
                  <SentenceLink
                    href={vm.links.contentPolicy}
                    external={true}
                    role="body"
                    testID="system.agreements-policy"
                  />
                ),
                privacy,
              }}
            />
          )}
        </Text>
        <View style={breakpoint === 'compact' ? LEAVE_COMPACT : LEAVE}>
          <Text role="caption" tone="secondary">
            <Trans
              t={t}
              i18nKey="system:agreements.leave"
              // The parser reads a tag named `link` as one that holds nothing, so the tag has another name:
              // https://github.com/i18next/html-parse-stringify/blob/v4.0.1/src/parse.js
              components={{
                delete: (
                  <SentenceLink
                    href={vm.deleteHref}
                    external={false}
                    role="caption"
                    testID="system.agreements-delete"
                  />
                ),
              }}
            />
          </Text>
        </View>
      </View>
    </Sheet>
  );
}

export function AgreementsScreen(): JSX.Element {
  return <AgreementsScreenView vm={useAgreementsViewModel()} />;
}
