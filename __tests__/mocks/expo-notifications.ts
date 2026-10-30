/**
 * expo-notifications under Jest (D225): the library's native module has no JS implementation here. This stands in for
 * the calls the app makes, and lets a test say what iOS answers and fire a tapped push. `__state` is reset per test.
 */
type Listener = (value: unknown) => void;

export const __state = {
  permission: 'undetermined' as 'granted' | 'denied' | 'undetermined',
  askAnswer: 'granted' as 'granted' | 'denied' | 'undetermined',
  token: 'ExponentPushToken[test]',
  lastResponse: null as unknown,
  asked: 0,
  responses: new Set<Listener>(),
  received: new Set<Listener>(),
  tokens: new Set<Listener>(),
  reset() {
    this.permission = 'undetermined';
    this.askAnswer = 'granted';
    this.token = 'ExponentPushToken[test]';
    this.lastResponse = null;
    this.asked = 0;
    this.responses.clear();
    this.received.clear();
    this.tokens.clear();
  },
};

const subscribe = (set: Set<Listener>, listener: Listener) => {
  set.add(listener);
  return { remove: () => set.delete(listener) };
};

export const setNotificationHandler = jest.fn();
export const getPermissionsAsync = jest.fn(async () => ({ status: __state.permission, granted: __state.permission === 'granted', canAskAgain: __state.permission !== 'denied' }));
export const requestPermissionsAsync = jest.fn(async () => {
  __state.asked += 1;
  __state.permission = __state.askAnswer;
  return { status: __state.permission, granted: __state.permission === 'granted', canAskAgain: __state.permission !== 'denied' };
});
export const getExpoPushTokenAsync = jest.fn(async () => ({ type: 'expo', data: __state.token }));
export const addPushTokenListener = jest.fn((l: Listener) => subscribe(__state.tokens, l));
export const addNotificationResponseReceivedListener = jest.fn((l: Listener) => subscribe(__state.responses, l));
export const addNotificationReceivedListener = jest.fn((l: Listener) => subscribe(__state.received, l));
export const getLastNotificationResponse = jest.fn(() => __state.lastResponse);
export const getLastNotificationResponseAsync = jest.fn(async () => __state.lastResponse);
export const clearLastNotificationResponseAsync = jest.fn(async () => {
  __state.lastResponse = null;
});

/** A push tapped with the app running. */
export function __tap(identifier: string, data: Record<string, unknown>) {
  const response = { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: { request: { identifier, content: { data } } } };
  for (const l of [...__state.responses]) l(response);
}
/** The tap that launched the app from closed. */
export function __launchedBy(identifier: string, data: Record<string, unknown>) {
  __state.lastResponse = { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: { request: { identifier, content: { data } } } };
}
