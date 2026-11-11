import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import SetupScreen from '../screens/SetupScreen';

function flattenTextChildren(value) {
  if (Array.isArray(value)) return value.flatMap(flattenTextChildren);
  return value == null ? [] : [value];
}

describe('SetupScreen', () => {
  it('renderiza bloques de ayuda y dispara navegacion', () => {
    const onOpenScreen = jest.fn();
    let tree;

    act(() => {
      tree = renderer.create(
        <SetupScreen onOpenScreen={onOpenScreen} themeMode="light" />,
      );
    });

    const textNodes = tree.root.findAllByType(Text).flatMap((node) => flattenTextChildren(node.props.children));
    expect(textNodes).toContain('Rutas guiadas');
    expect(textNodes).toContain('Ayuda rápida');
    expect(textNodes).toContain('Vender');

    const pressables = tree.root.findAll((node) => typeof node.props.onPress === 'function');
    for (const pressable of pressables) {
      if (onOpenScreen.mock.calls.length > 0) break;
      if (typeof pressable.props.onPress !== 'function') continue;
      act(() => {
        pressable.props.onPress();
      });
    }

    expect(onOpenScreen).toHaveBeenCalled();
  });
});
