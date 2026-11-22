/**
 * dpad protocol v1 message catalog.
 *
 * Direction: the app (SDK) opens a WebSocket to the host and sends `dpad.hello`.
 * After a successful handshake the host sends requests to the app; the app sends notifications.
 *
 * Coordinates are logical pixels in the app's root coordinate space, origin top-left.
 */

export const PROTOCOL_VERSION = '1.0.0';

/** Protocol domains an SDK may implement. Announced in the handshake. */
export type Domain = 'tree' | 'focus' | 'sync' | 'media' | 'state' | 'logs' | 'metrics';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Framework-neutral UI node as reported by an SDK. */
export interface ProtocolNode {
  /** Stable for the lifetime of the underlying element. */
  readonly id: string;
  readonly testId?: string;
  /** Own visible text (not concatenated descendants). */
  readonly text?: string;
  readonly label?: string;
  readonly role?: string;
  readonly bounds: Rect;
  readonly visible: boolean;
  readonly focusable: boolean;
  readonly focused: boolean;
  readonly enabled: boolean;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly children: readonly ProtocolNode[];
}

export interface HelloParams {
  readonly protocol: string;
  readonly token: string;
  /** e.g. `@dpad-tv/sdk-react-native@0.1.0` */
  readonly sdk: string;
  /** e.g. `react-native`, `web`, `native-ios` */
  readonly framework: string;
  readonly domains: readonly Domain[];
}

export interface HelloResult {
  readonly protocol: string;
  readonly sessionId: string;
}

export type MediaState =
  'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';

export interface MediaInfo {
  readonly state: MediaState;
  /** Seconds. */
  readonly position: number;
  /** Seconds; `null` for live or unknown. */
  readonly duration: number | null;
  readonly rate: number;
  readonly error?: string;
}

export interface BusyResource {
  /** e.g. `network`, `animation`, `timer`, `navigation`, `custom` */
  readonly kind: string;
  /** Human readable, e.g. `GET /api/home`. */
  readonly description: string;
}

export interface FocusGraphNode {
  readonly id: string;
  readonly up?: string;
  readonly down?: string;
  readonly left?: string;
  readonly right?: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntryParams {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: number;
}

/** Requests sent from host to app. */
export interface HostToAppRequests {
  'tree.get': { params: { readonly rootId?: string }; result: { readonly root: ProtocolNode } };
  'focus.get': { params: Record<string, never>; result: { readonly node: ProtocolNode | null } };
  'focus.graph': {
    params: { readonly rootId?: string };
    result: { readonly nodes: readonly FocusGraphNode[] };
  };
  'sync.waitForIdle': {
    params: { readonly timeoutMs: number; readonly quietMs?: number };
    result: { readonly idle: boolean; readonly busy: readonly BusyResource[] };
  };
  'media.get': { params: { readonly id?: string }; result: { readonly media: MediaInfo | null } };
  'state.apply': {
    params: {
      readonly state?: string;
      readonly flags?: Readonly<Record<string, string | number | boolean>>;
    };
    result: Record<string, never>;
  };
}

/** Requests sent from app to host. */
export interface AppToHostRequests {
  'dpad.hello': { params: HelloParams; result: HelloResult };
}

/** Notifications sent from app to host. */
export interface AppToHostNotifications {
  'focus.changed': { readonly from: string | null; readonly to: string | null };
  'logs.entry': LogEntryParams;
  'media.changed': MediaInfo;
}

export type HostToAppMethod = keyof HostToAppRequests;
export type AppToHostNotificationMethod = keyof AppToHostNotifications;

/** Which domain each host-to-app method belongs to. */
export const METHOD_DOMAIN: Readonly<Record<HostToAppMethod, Domain>> = {
  'tree.get': 'tree',
  'focus.get': 'focus',
  'focus.graph': 'focus',
  'sync.waitForIdle': 'sync',
  'media.get': 'media',
  'state.apply': 'state',
};
