import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useColors } from '../lib/design/theme';

// Splash while AuthProvider bootstraps; useProtectedRoute redirects away.
export default function Index() {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface.canvas }}>
      <ActivityIndicator color={colors.brand[600]} size="large" />
    </View>
  );
}
