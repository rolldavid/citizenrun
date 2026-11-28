import { Children } from 'react';
import type { JSX, ReactElement, ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Link } from '@/ui/components/link';
import { Text } from '@/ui/components/text';
import type { TextTone } from '@/ui/components/text';
import type { TypeRole } from '@/ui/typography';

import { AUTH_NAMESPACES } from './auth-translation';

/** Where one linked word of a sentence leads, and the id it is found by. */
export type SentenceLinkTarget = { href: string; testID: string };

type SentenceLinkProps = SentenceLinkTarget & {
  role: TypeRole;
  /** The words between the tags of the sentence, placed by the translation. */
  children?: ReactNode;
};

const OUTSIDE = 'https://';

/** The words a translated tag holds. */
function wordsOf(children: ReactNode): string {
  return Children.toArray(children)
    .filter((child) => typeof child === 'string')
    .join('');
}

/**
 * One linked word of a sentence. It is a link only to an address outside the app that is safe to
 * open; to anything else it is the same words as plain text, in the sentence's own tone.
 */
function SentenceLink({ href, testID, role, children }: SentenceLinkProps): JSX.Element {
  const words = wordsOf(children);
  if (!href.startsWith(OUTSIDE)) {
    return <Text role={role}>{words}</Text>;
  }
  return (
    <Link href={href} external={true} label={words} testID={testID}>
      <Text role={role} tone="primary">
        {words}
      </Text>
    </Link>
  );
}

export type LinkedSentenceProps = {
  /** One whole sentence whose tags are the names of `links`. */
  i18nKey: 'auth:welcome.legal' | 'auth:methods.legal' | 'auth:agree.label';
  role: TypeRole;
  tone: TextTone;
  /** By the tag each stands for in the sentence. */
  links: Readonly<Record<string, SentenceLinkTarget>>;
};

/** A translated sentence with links inside it: one key, and each tag drawn as one link. */
export function LinkedSentence({ i18nKey, role, tone, links }: LinkedSentenceProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const components: Record<string, ReactElement> = {};
  for (const [tag, target] of Object.entries(links)) {
    components[tag] = <SentenceLink href={target.href} testID={target.testID} role={role} />;
  }
  return (
    <Text role={role} tone={tone}>
      <Trans t={t} i18nKey={i18nKey} components={components} />
    </Text>
  );
}

export type LegalLineProps = {
  i18nKey: 'auth:welcome.legal' | 'auth:methods.legal';
  links: { terms: string; privacyPolicy: string };
  testIDs: { terms: string; privacy: string };
};

/** The one small line that names the terms and the privacy policy. */
export function LegalLine({ i18nKey, links, testIDs }: LegalLineProps): JSX.Element {
  return (
    <LinkedSentence
      i18nKey={i18nKey}
      role="caption"
      tone="secondary"
      links={{
        terms: { href: links.terms, testID: testIDs.terms },
        privacy: { href: links.privacyPolicy, testID: testIDs.privacy },
      }}
    />
  );
}
