import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { describe, expect, it } from 'vitest';

// Without the worklets Babel plugin, which the test pipeline does not run, a worklet hook needs
// its dependency array.
function Fixture(): ReactElement {
  const value = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: value.value }), [value]);
  const reduced = useReducedMotion();
  return (
    <>
      <Animated.View testID="fixture.animated" style={style} />
      <Pressable
        testID="fixture.press"
        accessibilityHint={reduced ? 'reduced' : 'full'}
        onPress={() => {
          value.set(withTiming(1));
        }}
      />
    </>
  );
}

describe('Reanimated in jsdom', () => {
  it('Reanimated mounts in jsdom', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      render(<Fixture />);
      await act(async () => {
        screen.getByTestId('fixture.press').click();
        await Promise.resolve();
      });
      expect(document.body.contains(screen.getByTestId('fixture.animated'))).toBe(true);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
