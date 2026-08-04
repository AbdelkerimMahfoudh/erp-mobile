import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store } from 'lucide-react-native';
import { Button, Field } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api-client';
import { colors } from '../../lib/theme';

export default function Login() {
  const { signIn } = useAuth();
  const [login, setLogin] = useState('owner');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await signIn(login.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View className="flex-1 justify-center px-6">
          <View className="mb-8 items-center">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-brand-600">
              <Store color="#fff" size={30} />
            </View>
            <Text className="mt-4 text-2xl font-bold text-slate-900">Retail ERP</Text>
            <Text className="mt-1 text-slate-500">Sign in to your store</Text>
          </View>

          <View className="gap-4">
            <Field label="Login" autoCapitalize="none" autoCorrect={false} value={login} onChangeText={setLogin} placeholder="owner" />
            <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} placeholder="••••••••" onSubmitEditing={onSubmit} />
            {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
            <Button title="Sign In" onPress={onSubmit} loading={loading} disabled={!login || !password} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
