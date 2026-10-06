/// <reference types="jest" />
/**
 * React Native's Jest preset replaces `ScrollView` with a mock that renders its
 * children but never PROVIDES the scroll context the real one does — and it is
 * that context VirtualizedList reads to warn "VirtualizedLists should never be
 * nested inside plain ScrollViews". Under the plain mock the warning cannot
 * fire, so a test asserting its absence would pass for the wrong reason.
 *
 * This wrapper keeps the preset's mock (nothing native) and adds the one thing
 * the check needs: the same context, with the same orientation value the real
 * ScrollView provides. The control test in `notifications.test.tsx` proves the
 * warning is raised here when the nesting exists.
 */
import React from 'react';
import ScrollViewContext, { HORIZONTAL, VERTICAL } from 'react-native/Libraries/Components/ScrollView/ScrollViewContext';

const PresetMock = jest.requireActual('@react-native/jest-preset/jest/mocks/ScrollView').default as React.ComponentType<Record<string, unknown>>;

export default class ScrollView extends React.Component<Record<string, unknown>> {
  static Context = ScrollViewContext;
  static displayName = 'ScrollView';

  render() {
    return (
      <ScrollViewContext.Provider value={this.props.horizontal ? HORIZONTAL : VERTICAL}>
        <PresetMock {...this.props} />
      </ScrollViewContext.Provider>
    );
  }
}
