import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '../lib/theme';

// Splash while AuthProvider bootstraps; useProtectedRoute redirects away.
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.brand} size="large" />
    </View>
  );
}
