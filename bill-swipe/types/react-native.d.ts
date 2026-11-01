/**
 * Minimal ambient declarations for react-native primitives used by the mobile
 * scaffold. In the real app these come from the `react-native` package; this
 * repo type-checks components without booting a full RN toolchain.
 */
declare module 'react-native' {
  import * as React from 'react';

  export type ViewStyle = Record<string, unknown>;
  export type TextStyle = Record<string, unknown>;
  export type ImageStyle = Record<string, unknown>;
  type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

  export class StyleSheet {
    static create<T extends NamedStyles<T>>(styles: T): T;
    static flatten(s: unknown): ViewStyle | undefined;
  }

  export interface ViewProps { style?: any; accessible?: boolean; accessibilityLabel?: string; accessibilityRole?: string; accessibilityValue?: any; accessibilityViewIsModal?: boolean; children?: React.ReactNode; onLayout?: (e: any) => void; testID?: string; }
  export const View: React.FC<ViewProps>;
  export const Text: React.FC<ViewProps & { numberOfLines?: number; onPress?: () => void }>;
  export interface PressableStateCallbackType { pressed: boolean }
  export type StyleProp<T> = T | T[] | false | null | undefined;
  export interface PressableProps extends ViewProps {
    onPress?: () => void;
    onLongPress?: () => void;
    disabled?: boolean;
    accessibilityState?: any;
    hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
    style?: StyleProp<any> | ((state: PressableStateCallbackType) => StyleProp<any>);
  }
  export const Pressable: React.FC<PressableProps>;
  /** Deprecated in real RN but still widely used; declared as an alias of PressableProps. */
  export const TouchableOpacity: React.FC<PressableProps & { activeOpacity?: number }>;
  export const Image: React.FC<{ source: { uri: string } | number; style?: any; resizeMode?: string; alt?: string; accessibilityLabel?: string; testID?: string }>;
  export const ScrollView: React.FC<{ contentContainerStyle?: any; children?: React.ReactNode }>;
  export const ActivityIndicator: React.FC<{ style?: any; color?: string }>;
  export const TextInput: React.FC<any>;
  export const Platform: { OS: 'ios' | 'android' | string; select: <T>(o: { ios?: T; android?: T; default?: T }) => T | undefined };
}
