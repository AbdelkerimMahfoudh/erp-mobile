import { Easing } from 'react-native-reanimated';
import { curve } from './motion';

/**
 * The easing curves from `motion.ts`, built for Reanimated.
 *
 * A separate file for one reason: `motion.ts` imports nothing, so the timings
 * and the Reduce Motion decision can be tested under bare node. Reanimated
 * cannot be resolved there, so the moment it is imported the whole motion
 * contract becomes untestable. Keeping the binding here costs one file and
 * keeps that boundary obvious.
 */
export const easing = {
  standard: Easing.bezier(...curve.standard),
  enter: Easing.bezier(...curve.enter),
  exit: Easing.bezier(...curve.exit),
} as const;
