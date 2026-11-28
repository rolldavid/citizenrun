import { assertNever } from '@citizenrun/shared';
import { useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { AUTH_NAMESPACES } from '@/features/auth/components/auth-translation';
import { CodeControl } from '@/features/auth/components/code-control';
import { EmailField, isEmailAddress } from '@/features/auth/components/email-field';
import { LegalLine, LinkedSentence } from '@/features/auth/components/legal-line';
import { signInNoticeText } from '@/features/auth/components/notice-text';
import { ProviderOptions } from '@/features/auth/components/provider-options';
import { StageFrame } from '@/features/auth/components/stage-frame';
import { stateNameKey } from '@/features/auth/components/state-name';
import type { SignInViewModel } from '@/features/auth/view-models/sign-in.types';
import { useSignInViewModel } from '@/features/auth/view-models/use-sign-in-view-model';
import {
  AdultsOnlyScreenView,
  UnavailableInStateScreenView,
  stateUnavailableViewModel,
} from '@/features/system';
import { head } from '@/platform/head';
import { Notice } from '@/ui/components/notice';
import { Select } from '@/ui/components/select';
import { Skeleton } from '@/ui/components/skeleton';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

type StageProps = { vm: SignInViewModel };

const TEST_ID = 'auth.sign-in';
/** A whole sign-in code. */
const WHOLE_CODE = /^[0-9]{6}$/;

const NOTICE: ViewStyle = { marginBottom: space.x4 };
const LEGAL: ViewStyle = { marginTop: space.x4 };

/**
 * `methods`: the providers' own buttons where they are offered, and email always. Under them one
 * small line names the terms and the privacy policy.
 */
function MethodsStage({ vm }: StageProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const notice = vm.notice === null ? null : signInNoticeText(vm.notice, t);
  return (
    <StageFrame
      onBack={vm.onBack}
      signingUp={vm.signingUp}
      offline={vm.offline}
      title={t('auth:methods.title')}
      testID={TEST_ID}
    >
      {notice === null ? null : (
        <View style={NOTICE}>
          <Notice kind={notice.kind} text={notice.text} />
        </View>
      )}
      <ProviderOptions
        appleButton={vm.appleButton}
        googleButton={vm.googleButton}
        email={{
          // Without a connection the option says so and takes no press.
          label: vm.offline ? t('common:states.offlineAction') : t('auth:methods.email'),
          onPress: vm.onChooseEmail,
          testID: 'auth.email-option',
        }}
        busy={vm.providersBusy || vm.offline}
      />
      <View style={LEGAL}>
        <LegalLine
          i18nKey="auth:methods.legal"
          links={vm.legalLinks}
          testIDs={{ terms: 'auth.methods-terms', privacy: 'auth.methods-privacy' }}
        />
      </View>
    </StageFrame>
  );
}

/** `email`: the address a code goes to. What is typed lives here and goes when the stage does. */
function EmailStage({ vm }: StageProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const [value, setValue] = useState('');
  const { email } = vm;
  const valid = isEmailAddress(value);
  const sending = email.status === 'sending';

  const submit = (): void => {
    if (valid && !sending && !vm.offline) {
      email.onSubmit(value.trim());
    }
  };

  return (
    <StageFrame
      onBack={vm.onBack}
      signingUp={vm.signingUp}
      offline={vm.offline}
      title={t('auth:email.title')}
      body={t('auth:email.body')}
      footer={{
        primary: {
          label: valid ? t('auth:email.continue') : t('auth:email.needAddress'),
          onPress: submit,
          disabled: !valid,
          busy: sending,
          testID: 'auth.email-continue',
        },
      }}
      fieldTakesFocus={true}
      testID={TEST_ID}
    >
      <EmailField
        value={value}
        onChangeText={setValue}
        onSubmit={submit}
        errorCode={email.errorCode}
        retryAfterSeconds={email.retryAfterSeconds}
        testID="auth.email-field"
      />
    </StageFrame>
  );
}

type CodeStageProps = StageProps & { code: NonNullable<SignInViewModel['code']> };

/** `code`: the six digits. They live here, are emptied by a wrong code, and go when the stage does. */
function CodeStage({ vm, code }: CodeStageProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const [value, setValue] = useState('');
  const [answered, setAnswered] = useState(code.status);
  if (answered !== code.status) {
    setAnswered(code.status);
    // A code that turned out wrong is typed again from the first box.
    if (code.status === 'wrong') {
      setValue('');
    }
  }

  const whole = WHOLE_CODE.test(value);
  const spent = code.status === 'locked' || code.status === 'expired';

  return (
    <StageFrame
      onBack={vm.onBack}
      signingUp={vm.signingUp}
      offline={vm.offline}
      title={t('auth:code.title')}
      footer={{
        primary: {
          label: whole || spent ? t('auth:code.verify') : t('auth:code.needCode'),
          onPress: () => {
            code.onSubmit(value);
          },
          disabled: !whole || spent,
          busy: code.status === 'checking',
          testID: 'auth.code-verify',
        },
      }}
      testID={TEST_ID}
    >
      <CodeControl
        code={code}
        value={value}
        onChangeText={setValue}
        testIDs={{ field: 'auth.code-field' }}
      />
    </StageFrame>
  );
}

/** `checkingAge` and `finishing`: the app is working, and asks nothing. */
function WaitingStage({ vm }: StageProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  return (
    <StageFrame
      onBack={vm.onBack}
      signingUp={vm.signingUp}
      offline={vm.offline}
      title={t('auth:wait.title')}
      testID={TEST_ID}
    >
      <Skeleton shape="line" lines={2} />
    </StageFrame>
  );
}

type StateStageProps = StageProps & { statePicker: NonNullable<SignInViewModel['statePicker']> };

/** `state`: where the person lives, asked once and only where a state's rule differs. */
function StateStage({ vm, statePicker }: StateStageProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const [chosen, setChosen] = useState<string | null>(null);
  // Each state under its name, in the order of the names.
  const options = statePicker.codes
    .flatMap((code) => {
      const key = stateNameKey(code);
      return key === null ? [] : [{ value: code, label: t(key) }];
    })
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  return (
    <StageFrame
      onBack={vm.onBack}
      signingUp={vm.signingUp}
      offline={vm.offline}
      title={t('auth:state.title')}
      body={t('auth:state.body')}
      footer={{
        primary: {
          label: chosen === null ? t('auth:state.needState') : t('auth:state.continue'),
          onPress: () => {
            if (chosen !== null) {
              statePicker.onSubmit(chosen);
            }
          },
          disabled: chosen === null,
          testID: 'auth.state-continue',
        },
      }}
      testID={TEST_ID}
    >
      <Select
        label={t('auth:state.label')}
        placeholder={t('auth:state.placeholder')}
        value={chosen}
        options={options}
        onChange={setChosen}
        testID="auth.state-select"
      />
    </StageFrame>
  );
}

type AgreementsStageProps = StageProps & {
  agreements: NonNullable<SignInViewModel['agreements']>;
};

/** `agreements`: one sentence, three documents and one explicit tap. Nothing is ticked for anyone (D-351). */
function AgreementsStage({ vm, agreements }: AgreementsStageProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const { links } = agreements;
  return (
    <StageFrame
      onBack={vm.onBack}
      signingUp={vm.signingUp}
      offline={vm.offline}
      title={t('auth:agree.title')}
      footer={{
        primary: {
          label: t('auth:agree.action'),
          onPress: agreements.onAgree,
          testID: 'onboarding.terms-agree',
        },
      }}
      testID={TEST_ID}
    >
      <LinkedSentence
        i18nKey="auth:agree.body"
        role="body"
        tone="primary"
        links={{
          terms: { href: links.terms, testID: 'auth.agree-terms' },
          policy: { href: links.contentPolicy, testID: 'auth.agree-policy' },
          privacy: { href: links.privacyPolicy, testID: 'auth.agree-privacy' },
        }}
      />
    </StageFrame>
  );
}

type AiConsentStageProps = StageProps & { aiConsent: NonNullable<SignInViewModel['aiConsent']> };

/** `aiConsent`: the screening sentence, word for word, and two answers, neither one chosen (D-351). */
function AiConsentStage({ vm, aiConsent }: AiConsentStageProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  return (
    <StageFrame
      onBack={vm.onBack}
      signingUp={vm.signingUp}
      offline={vm.offline}
      title={t('auth:ai.title')}
      footer={{
        primary: {
          label: t('auth:ai.allow'),
          onPress: () => {
            aiConsent.onAnswer(true);
          },
          testID: 'onboarding.ai-consent-agree',
        },
        secondary: {
          variant: 'secondary',
          label: t('auth:ai.notNow'),
          onPress: () => {
            aiConsent.onAnswer(false);
          },
          testID: 'auth.ai-not-now',
        },
      }}
      testID={TEST_ID}
    >
      <Text role="body">{t('auth:ai.sentence')}</Text>
    </StageFrame>
  );
}

/** One stage at a time; a stage whose own part of the view-model is missing asks nothing. */
function Stage({ vm }: StageProps): JSX.Element {
  switch (vm.stage) {
    case 'methods':
      return <MethodsStage vm={vm} />;
    case 'email':
      return <EmailStage vm={vm} />;
    case 'code':
      return vm.code === null ? <WaitingStage vm={vm} /> : <CodeStage vm={vm} code={vm.code} />;
    case 'checkingAge':
    case 'finishing':
      return <WaitingStage vm={vm} />;
    case 'state':
      return vm.statePicker === null ? (
        <WaitingStage vm={vm} />
      ) : (
        <StateStage vm={vm} statePicker={vm.statePicker} />
      );
    case 'agreements':
      return vm.agreements === null ? (
        <WaitingStage vm={vm} />
      ) : (
        <AgreementsStage vm={vm} agreements={vm.agreements} />
      );
    case 'aiConsent':
      return vm.aiConsent === null ? (
        <WaitingStage vm={vm} />
      ) : (
        <AiConsentStage vm={vm} aiConsent={vm.aiConsent} />
      );
    default:
      return assertNever(vm.stage);
  }
}

/**
 * SCR-sign-in: every sign-in and the first step of sign-up, on one screen that moves stage by
 * stage. A stage is one heading, one control and one button, and the next stage replaces it with a
 * cut. While the person may not go on, the screen that says why stands in place of the stages.
 */
export function SignInScreenView({ vm }: { vm: SignInViewModel }): JSX.Element {
  if (vm.blocked === 'adultsOnly') {
    return <AdultsOnlyScreenView vm={{ onClose: vm.onBack }} />;
  }
  if (vm.blocked !== null) {
    return (
      <UnavailableInStateScreenView
        vm={stateUnavailableViewModel({
          stateCode: vm.blocked.stateUnavailable,
          signedIn: false,
          onBack: vm.onBack,
        })}
      />
    );
  }
  return <Stage vm={vm} />;
}

export function SignInScreen({ next }: { next: string | null }): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const vm = useSignInViewModel({ next });
  return (
    <>
      <head.Title>
        {t('common:documentTitle', { title: t('auth:methods.documentTitle') })}
      </head.Title>
      <SignInScreenView vm={vm} />
    </>
  );
}
