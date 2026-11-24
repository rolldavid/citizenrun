import { color, issue } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { artRoles, canvasColorsFrom } from './colors.ts';

const light = canvasColorsFrom('light', color.light, issue);
const dark = canvasColorsFrom('dark', color.dark, issue);

describe('canvasColorsFrom', () => {
  it('copies the eleven core colors of the light theme', () => {
    const { issue: issues, ...core } = light;
    expect(core).toEqual({
      theme: 'light',
      bg: '#F1EFE7',
      surface: '#FDFCF9',
      text: '#141412',
      textSecondary: '#535148',
      ruleSoft: '#D5D2C7',
      accent: '#F04E14',
      highlight: '#D9F23E',
      onHighlight: '#141412',
      posterBg: '#141412',
      posterText: '#F3F1EA',
      posterTextSecondary: '#A9A69B',
    });
    expect(Object.keys(issues).sort()).toEqual(Object.keys(issue).sort());
  });

  it('copies the eleven core colors of the dark theme from the dark tokens', () => {
    const { issue: issues, ...core } = dark;
    expect(core).toEqual({
      theme: 'dark',
      bg: color.dark.bg,
      surface: color.dark.surface,
      text: color.dark.text,
      textSecondary: color.dark.textSecondary,
      ruleSoft: color.dark.ruleSoft,
      accent: color.dark.accent,
      highlight: color.dark.highlight,
      onHighlight: color.dark.onHighlight,
      posterBg: color.dark.posterBg,
      posterText: color.dark.posterText,
      posterTextSecondary: color.dark.posterTextSecondary,
    });
    expect(Object.keys(issues).sort()).toEqual(Object.keys(issue).sort());
  });

  it('holds only the eleven core colors, the theme and the issues', () => {
    expect(Object.keys(light).sort()).toEqual(
      [
        'accent',
        'bg',
        'highlight',
        'issue',
        'onHighlight',
        'posterBg',
        'posterText',
        'posterTextSecondary',
        'ruleSoft',
        'surface',
        'text',
        'textSecondary',
        'theme',
      ].sort(),
    );
  });

  it("gives an issue the theme's fill and the dark value as its poster color", () => {
    expect(light.issue.climate).toEqual({ fill: '#248F41', poster: '#42A859', on: '#141412' });
    expect(dark.issue.climate).toEqual({ fill: '#42A859', poster: '#42A859', on: '#141412' });
  });

  it('holds no entry for an issue id the tokens do not have', () => {
    expect(light.issue['unknown-id']).toBeUndefined();
    expect(Object.hasOwn(light.issue, 'unknown-id')).toBe(false);
    expect(canvasColorsFrom('light', color.light, {}).issue).toEqual({});
  });

  it('reads the issues it is given and no token module of its own', () => {
    const colors = canvasColorsFrom('dark', color.light, {
      one: { light: 'one-light', dark: 'one-dark', on: 'one-on' },
    });
    expect(colors.theme).toBe('dark');
    expect(colors.text).toBe('#141412');
    expect(colors.issue).toEqual({ one: { fill: 'one-dark', poster: 'one-dark', on: 'one-on' } });
  });
});

describe('artRoles', () => {
  it('on paper with no issue takes the secondary text color as its tone', () => {
    expect(artRoles(light, null, 'paper')).toEqual({
      ink: '#141412',
      paper: '#FDFCF9',
      tone: '#535148',
      spot: '#F04E14',
    });
  });

  it("on a poster takes the poster colors and the issue's dark value", () => {
    expect(artRoles(light, 'climate', 'poster')).toEqual({
      ink: '#F3F1EA',
      paper: '#141412',
      tone: '#42A859',
      spot: '#F04E14',
    });
  });

  it("on paper takes the issue's fill of the theme", () => {
    expect(artRoles(light, 'climate', 'paper').tone).toBe('#248F41');
    expect(artRoles(dark, 'climate', 'paper').tone).toBe('#42A859');
  });

  it('falls back to the secondary text color for an issue id it does not hold', () => {
    expect(artRoles(light, 'unknown-id', 'paper').tone).toBe(light.textSecondary);
    expect(artRoles(light, 'unknown-id', 'poster').tone).toBe(light.posterTextSecondary);
    expect(artRoles(light, null, 'poster').tone).toBe(light.posterTextSecondary);
  });

  it('does not read a name an object inherits as an issue', () => {
    expect(artRoles(light, 'toString', 'paper').tone).toBe(light.textSecondary);
    expect(artRoles(light, 'constructor', 'poster').tone).toBe(light.posterTextSecondary);
  });
});
