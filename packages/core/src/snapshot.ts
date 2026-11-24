import type { Rect } from '@toets/protocol';

export type { Rect };

/** Opaque, driver-issued reference to an element. Valid until the element is detached. */
export type ElementRef = string & { readonly __elementRef: unique symbol };

/**
 * Platform-neutral state of one element at one moment. Matchers are implemented once,
 * in the core, against this shape; drivers and SDKs only need to fill it in faithfully.
 */
export interface ElementSnapshot {
  readonly ref: ElementRef;
  readonly testId: string | null;
  /** Visible text of the element including descendants, whitespace-normalized. */
  readonly text: string | null;
  readonly label: string | null;
  readonly bounds: Rect;
  /** Attached, non-zero size, not hidden by the platform. */
  readonly visible: boolean;
  /** Intersects the app viewport. */
  readonly inViewport: boolean;
  readonly focusable: boolean;
  readonly focused: boolean;
  /** The element or one of its descendants is focused. */
  readonly focusWithin: boolean;
  readonly enabled: boolean;
  readonly selected: boolean;
  /** The element or one of its descendants reports busy (loading). */
  readonly busy: boolean;
}

export interface UINode extends ElementSnapshot {
  readonly children: readonly UINode[];
}

export interface UITree {
  readonly root: UINode;
  /** Viewport size in the tree's coordinate space. */
  readonly viewport: { readonly width: number; readonly height: number };
}

export interface LogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly timestamp: number;
  readonly source: 'app' | 'device' | 'driver';
}
