import { create } from 'zustand';

/**
 * "Somebody just signed in on this phone" (D225): set by a password sign-in or a completed registration, read once by
 * the push bridge to decide whether to offer notifications. A session restored at launch never sets it, so the app
 * never talks about notifications at a cold launch.
 */
export const usePushOffer = create<{ justSignedIn: boolean; signedIn: () => void; done: () => void }>((set) => ({
  justSignedIn: false,
  signedIn: () => set({ justSignedIn: true }),
  done: () => set({ justSignedIn: false }),
}));
