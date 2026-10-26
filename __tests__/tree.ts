/**
 * Rendered-tree lookups for React Native Testing Library 14 (D222).
 *
 * RNTL 14 renders with Test Renderer, which exposes host elements only, so v13's
 * `UNSAFE_*ByType` queries are gone. Host inputs are found on the container. The
 * few tests that must see the app's own components — what sits above a FlatList,
 * a TextField's props — walk React's fiber tree, which Test Renderer exposes as
 * `unstable_fiber`, and get nodes shaped like v13's instances (type, props, parent).
 */
import { screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

/** The text inputs on screen, in screen order: what `UNSAFE_getAllByType(TextInput)` returned. */
export function textInputs(): TestInstance[] {
  return screen.container.queryAll((n) => n.type === 'TextInput');
}

/** The one text input on screen, as `UNSAFE_getByType(TextInput)` required. */
export function textInput(): TestInstance {
  const all = textInputs();
  if (all.length !== 1) throw new Error(`expected exactly one text input, found ${all.length}`);
  return all[0];
}

type Fiber = {
  type: unknown;
  elementType: unknown;
  memoizedProps: Record<string, unknown> | null;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  stateNode: unknown;
};

/** A component in the rendered tree, shaped like a v13 test instance. */
export type ComponentNode = {
  type: unknown;
  props: Record<string, any>;
  readonly parent: ComponentNode | null;
  fiber: Fiber;
};

function toNode(fiber: Fiber): ComponentNode {
  return {
    type: fiber.elementType ?? fiber.type,
    props: (fiber.memoizedProps ?? {}) as Record<string, any>,
    get parent() {
      return fiber.return ? toNode(fiber.return) : null;
    },
    fiber,
  };
}

/** The current fiber tree's root, reached from any rendered host element. */
function currentRoot(): Fiber {
  const first = screen.container.children.find((c): c is TestInstance => typeof c !== 'string');
  if (!first || !first.unstable_fiber) throw new Error('nothing is rendered');
  let fiber = first.unstable_fiber as unknown as Fiber;
  while (fiber.return) fiber = fiber.return;
  // The host root's state node is the FiberRoot; its `current` is the committed tree.
  return (fiber.stateNode as { current: Fiber }).current;
}

/** Every mounted instance of a component, in tree order. */
export function componentsOfType(type: unknown): ComponentNode[] {
  const found: ComponentNode[] = [];
  const walk = (fiber: Fiber | null) => {
    for (let f = fiber; f; f = f.sibling) {
      if (f.elementType === type || f.type === type) found.push(toNode(f));
      walk(f.child);
    }
  };
  walk(currentRoot());
  return found;
}

/** The one mounted instance of a component. */
export function componentOfType(type: unknown): ComponentNode {
  const all = componentsOfType(type);
  if (all.length !== 1) throw new Error(`expected exactly one instance, found ${all.length}`);
  return all[0];
}

/**
 * Every component and host element rendered inside a host element whose props
 * satisfy the predicate — what v13's `instance.findAll(predicate)` searched.
 * The app's own components count, so a Pressable's `onPress` is seen even
 * though its host view does not carry it.
 */
export function componentsWithin(
  instance: TestInstance,
  predicate: (props: Record<string, any>) => boolean,
): ComponentNode[] {
  const top = instance.unstable_fiber as unknown as Fiber | null;
  if (!top) throw new Error('that element is not mounted');
  const found: ComponentNode[] = [];
  const walk = (fiber: Fiber | null) => {
    for (let f = fiber; f; f = f.sibling) {
      if (f.memoizedProps && typeof f.memoizedProps === 'object' && predicate(f.memoizedProps)) found.push(toNode(f));
      walk(f.child);
    }
  };
  walk(top.child);
  return found;
}

/** The text input rendered inside a component. */
export function textInputWithin(component: ComponentNode): TestInstance {
  const owner = new Set([component.fiber, component.fiber.alternate].filter(Boolean));
  const input = textInputs().find((i) => {
    for (let f = i.unstable_fiber as unknown as Fiber | null; f; f = f.return) if (owner.has(f)) return true;
    return false;
  });
  if (!input) throw new Error('no text input inside that component');
  return input;
}
