import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import SetupScreen from '../screens/SetupScreen';

describe('SetupScreen', () => {
  it('renderiza bloques de ayuda y dispara navegacion', () => {
    const onOpenScreen = jest.fn();
    const tree = renderer.create(
      <SetupScreen onOpenScreen={onOpenScreen} themeMode="light" />,
    );

    const textNodes = tree.root.findAllByType(Text).map((node) => node.props.children).flat();
    expect(textNodes).toContain('Rutas guiadas');
    expect(textNodes).toContain('Ayuda rápida');

    const pressables = tree.root.findAllByType(Pressable);
    const guidedRoute = pressables.find((node) => {
      return node.findAllByType(Text).some((textNode) => textNode.props.children === 'Vender');
    });
    expect(guidedRoute).toBeTruthy();

    act(() => {
      guidedRoute.props.onPress();
    });

    expect(onOpenScreen).toHaveBeenCalled();
  });
});
