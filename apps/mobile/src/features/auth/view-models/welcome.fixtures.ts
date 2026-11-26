import type { WelcomeViewModel } from './welcome.types';

export const welcomeDefault = {
  startHref: '/sign-in',
  links: { terms: 'https://example.test/terms', privacyPolicy: 'https://example.test/privacy' },
} satisfies WelcomeViewModel;
