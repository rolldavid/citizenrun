import { formatDate } from '@citizenrun/shared';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { localDateOf } from '@/features/settings/components/instant-text';
import * as fixtures from '@/features/settings/view-models/settings-profile.fixtures';
import type { SettingsProfileViewModel } from '@/features/settings/view-models/settings-profile.types';
import { FIXTURE_PHOTO_URI } from '@/lib/view-models/__fixtures__/common';
import { renderWithProviders, setViewport } from '@/test/render';
import { ToastHost } from '@/ui/components/toast';

import { SettingsProfileScreenView } from './settings-profile-screen';

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// A drawing of the app loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a drawing of the app loads no asset');
  },
}));

const FIXTURES: Readonly<Record<string, SettingsProfileViewModel>> = fixtures;
type Ready = Extract<SettingsProfileViewModel, { status: 'ready' }>;
type ProfileData = Ready['data'];

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SettingsProfileViewModel): HTMLElement {
  cleanup();
  setViewport(390, 844);
  renderWithProviders(
    <ToastHost>
      <SettingsProfileScreenView vm={vm} />
    </ToastHost>,
  );
  return screen.getByTestId('settings.profile');
}

/** Opens the screen in an app that is already running, as a person reaches it. */
function open(vm: SettingsProfileViewModel): void {
  cleanup();
  setViewport(390, 844);
  const view = renderWithProviders(<ToastHost>{null}</ToastHost>);
  act(() => {
    view.rerender(
      <ToastHost>
        <SettingsProfileScreenView vm={vm} />
      </ToastHost>,
    );
  });
}

/** A ready fixture with some of its data replaced. */
function withData(base: Ready, data: Partial<ProfileData>): Ready {
  return { ...base, data: { ...base.data, ...data } };
}

function valueOf(testID: string): string {
  const field = screen.getByTestId(testID);
  if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) {
    throw new Error(`${testID} is no text field`);
  }
  return field.value;
}

describe('SettingsProfileScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(12);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
      const headings = within(root).getAllByRole('heading', { level: 1 });
      expect(
        headings.map((heading) => heading.textContent),
        name,
      ).toEqual(['Edit profile']);
    }
  });

  it('the fields start from the profile', () => {
    draw(fixtures.profileEdit);
    const { me } = fixtures.profileEdit.data;
    expect(valueOf('settings.profile-name')).toBe(me.name);
    expect(valueOf('settings.profile-bio')).toBe('Fixture bio text.');
    expect(valueOf('settings.profile-link')).toBe('https://example.test/fixture');
    expect(valueOf('settings.profile-handle')).toBe(me.handle);
    // A profile with no photo has none to take away, and neither has one with a new photo chosen.
    expect(screen.queryByTestId('settings.profile-remove-photo')).toBeNull();
    draw(fixtures.profileEditAvatarPending);
    expect(screen.getByTestId('settings.profile-remove-photo').textContent).toBe('Remove');
    draw(
      withData(fixtures.profileEditAvatarPending, { photo: fixtures.profileEditDirty.data.photo }),
    );
    expect(screen.queryByTestId('settings.profile-remove-photo')).toBeNull();
  });

  it('save waits for a change', () => {
    const onSave = vi.fn();
    draw(withData(fixtures.profileEdit, { onSave }));
    const { me } = fixtures.profileEdit.data;

    const waiting = screen.getByTestId('settings.profile-save');
    expect(waiting.textContent).toBe('No changes');
    expect(waiting.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(waiting);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('settings.profile-name'), {
      target: { value: 'Another Name' },
    });
    const ready = screen.getByTestId('settings.profile-save');
    expect(ready.textContent).toBe('Save');
    expect(ready.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(ready);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenLastCalledWith({
      name: 'Another Name',
      bio: 'Fixture bio text.',
      link: 'https://example.test/fixture',
      handle: me.handle,
    });

    // Typing the profile's own text back leaves nothing to save.
    fireEvent.change(screen.getByTestId('settings.profile-name'), {
      target: { value: me.name },
    });
    expect(screen.getByTestId('settings.profile-save').textContent).toBe('No changes');
  });

  it('a new photo is no change to save', () => {
    draw(fixtures.profileEditDirty);
    const button = screen.getByTestId('settings.profile-save');
    expect(button.textContent).toBe('No changes');
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('a save on its way waits', () => {
    const onSave = vi.fn();
    draw(withData(fixtures.profileEditSaving, { onSave }));
    const button = screen.getByTestId('settings.profile-save');
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a handle that is not free cannot be saved', () => {
    const onSave = vi.fn();
    const onChange = vi.fn();
    draw(
      withData(fixtures.profileEdit, {
        onSave,
        handle: { check: 'taken', invalidReason: null, onChange },
      }),
    );
    fireEvent.change(screen.getByTestId('settings.profile-handle'), {
      target: { value: 'someone_else' },
    });
    expect(onChange).toHaveBeenLastCalledWith('someone_else');
    const root = screen.getByTestId('settings.profile');
    expect(root.textContent).toContain('Taken. Try another.');
    const button = screen.getByTestId('settings.profile-save');
    expect(button.textContent).toBe('Pick a handle that is free');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('field errors', () => {
    const root = draw(fixtures.profileEditFieldErrors);
    expect(root.textContent).toContain('Use 50 characters or fewer.');
    expect(root.textContent).toContain('Use a full https:// address.');
    expect(root.textContent).not.toContain('Use 160 characters or fewer.');

    const bio = draw(
      withData(fixtures.profileEdit, {
        save: { status: 'idle', fields: { bio: 'too_long' }, errorCode: null },
      }),
    );
    expect(bio.textContent).toContain('Use 160 characters or fewer.');

    // A refusal with no field of its own is said above the bar.
    const refused = draw(
      withData(fixtures.profileEdit, {
        save: { status: 'idle', fields: {}, errorCode: 'unavailable' },
      }),
    );
    expect(within(refused).getByRole('alert').textContent).toBe(
      "This isn't available right now. Try again in a few minutes.",
    );
  });

  it('locked handle', () => {
    const root = draw(fixtures.profileEditHandleLocked);
    const { me } = fixtures.profileEditHandleLocked.data;
    const field = screen.getByTestId('settings.profile-handle');
    expect(valueOf('settings.profile-handle')).toBe(me.handle);
    expect(field.getAttribute('aria-disabled')).toBe('true');
    const day = localDateOf(me.handleChangeAvailableAt ?? '');
    expect(day).not.toBeNull();
    expect(root.textContent).toContain(
      `You can change your handle again on ${formatDate(day ?? '', 'en', 'long')}.`,
    );
    // The helper of a handle that can change is not drawn beside the date.
    expect(root.textContent).not.toContain('You can change it once every 30 days.');

    const open = draw(fixtures.profileEdit);
    expect(open.textContent).toContain('You can change it once every 30 days.');
    expect(screen.getByTestId('settings.profile-handle').getAttribute('aria-disabled')).toBeNull();
  });

  it('pending avatar', () => {
    expect(draw(fixtures.profileEditAvatarPending).textContent).toContain(
      'Your new photo is being checked.',
    );
    expect(draw(fixtures.profileEdit).textContent).not.toContain(
      'Your new photo is being checked.',
    );
  });

  it('the photo buttons', () => {
    const onChoosePhoto = vi.fn();
    const onRemovePhoto = vi.fn();
    // The fixture's profile has a photo, so there is one to take away.
    draw(withData(fixtures.profileEditAvatarPending, { onChoosePhoto, onRemovePhoto }));
    fireEvent.click(screen.getByTestId('settings.profile-change-photo'));
    expect(onChoosePhoto).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('settings.profile-remove-photo'));
    expect(onRemovePhoto).toHaveBeenCalledTimes(1);

    // A photo that did not go through says why.
    const failed = draw(
      withData(fixtures.profileEdit, {
        photo: { status: 'failed', previewUri: null, failure: 'photo_too_large' },
      }),
    );
    expect(within(failed).getByRole('alert').textContent).not.toBe('');

    // A photo on its way shows how much of it has gone, and its button waits.
    const sending = draw(
      withData(fixtures.profileEdit, {
        photo: {
          status: 'uploading',
          previewUri: FIXTURE_PHOTO_URI,
          sentBytes: 1,
          totalBytes: 4,
        },
      }),
    );
    expect(within(sending).getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByTestId('settings.profile-change-photo').getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  it('saved toast', () => {
    open(fixtures.profileEditSaved);
    expect(screen.getByTestId('toast').textContent).toBe('Profile saved.');
    cleanup();

    // A save that goes through while the screen is open says so once.
    const view = renderWithProviders(
      <ToastHost>
        <SettingsProfileScreenView vm={fixtures.profileEditSaving} />
      </ToastHost>,
    );
    expect(screen.queryByTestId('toast')).toBeNull();
    act(() => {
      view.rerender(
        <ToastHost>
          <SettingsProfileScreenView vm={fixtures.profileEditSaved} />
        </ToastHost>,
      );
    });
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByTestId('toast').textContent).toBe('Profile saved.');
  });

  it('AI consent sheet', () => {
    draw(fixtures.profileEdit);
    expect(screen.queryByTestId('settings.ai-consent')).toBeNull();

    const onAnswerAiConsent = vi.fn();
    draw(withData(fixtures.profileEditAiConsent, { onAnswerAiConsent }));
    const sheet = screen.getByTestId('settings.ai-consent');
    expect(sheet.textContent).toContain('One more choice');
    expect(sheet.textContent).toContain(
      'Public posts, comments and bios may be checked by an automated AI service run by Anthropic; direct messages never are.',
    );
    expect(sheet.textContent).toContain(
      'Your content is never sent to it. Keyword checks still apply.',
    );
    // Closing is never an answer: the sheet has no grabber to press.
    expect(screen.queryByTestId('settings.ai-consent-grabber')).toBeNull();
    const decline = screen.getByTestId('settings.ai-consent-decline');
    const allow = screen.getByTestId('settings.ai-consent-allow');
    expect(decline.textContent).toBe("Don't allow");
    expect(allow.textContent).toBe('Allow');
    // Neither answer is given for the person: the sheet opens with the question focused.
    expect(document.activeElement).not.toBe(decline);
    expect(document.activeElement).not.toBe(allow);
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toContain('One more choice');

    fireEvent.click(decline);
    expect(onAnswerAiConsent).toHaveBeenCalledTimes(1);
    expect(onAnswerAiConsent).toHaveBeenLastCalledWith(false);
    // While the answer is on its way the pressed button waits and the other takes no press.
    expect(screen.getByTestId('settings.ai-consent-decline').getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(screen.getByTestId('settings.ai-consent-allow').getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.click(screen.getByTestId('settings.ai-consent-allow'));
    expect(onAnswerAiConsent).toHaveBeenCalledTimes(1);
  });

  it('allowing answers yes', () => {
    const onAnswerAiConsent = vi.fn();
    draw(withData(fixtures.profileEditAiConsent, { onAnswerAiConsent }));
    fireEvent.click(screen.getByTestId('settings.ai-consent-allow'));
    expect(onAnswerAiConsent).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('settings.ai-consent-allow').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('settings.ai-consent-decline').getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('generic states', () => {
    const loading = draw(fixtures.profileEditLoading);
    expect(loading.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
    expect(screen.queryByTestId('settings.profile-save')).toBeNull();

    const onRetry = vi.fn();
    draw({ ...fixtures.profileEditError, onRetry });
    fireEvent.click(screen.getByTestId('settings.profile-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    expect(draw(fixtures.profileEditOffline).textContent).toContain('No connection.');

    // Shown from the cache: nothing can be saved, and the buttons say why.
    draw(fixtures.profileEditStale);
    const save = screen.getByTestId('settings.profile-save');
    expect(save.textContent).toBe('Needs a connection');
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('settings.profile-change-photo').getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
});
