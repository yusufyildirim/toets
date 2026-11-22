/**
 * dpad protocol v1 message catalog. The normative description lives in `docs/spec.md`.
 *
 * Direction: the app (SDK) opens a WebSocket to the host and sends `dpad.hello`.
 * After a successful handshake the host sends requests to the app; the app sends notifications.
 *
 * Coordinates are logical pixels (CSS px, dp, pt) in the app's root coordinate space,
 * origin top-left.
 */

/** Protocol version implemented by this package. See `docs/spec.md` > Versioning. */
export const PROTOCOL_VERSION = '1.0.0';

/** Method name of the handshake request (app to host). */
export const HELLO_METHOD = 'dpad.hello';

/** Protocol domains an SDK may implement. Announced in the handshake. */
export type Domain = 'tree' | 'focus' | 'sync' | 'media' | 'state' | 'logs' | 'metrics';

/** Every domain known to this protocol version. `metrics` is reserved (no methods yet). */
export const DOMAINS: readonly Domain[] = [
  'tree',
  'focus',
  'sync',
  'media',
  'state',
  'logs',
  'metrics',
];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Size of the app's root coordinate space. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  /** Physical pixels per logical pixel, when known. Lets the host map bounds onto screenshots. */
  readonly pixelRatio?: number;
}

/** Framework-neutral UI node as reported by an SDK. */
export interface ProtocolNode {
  /** Stable for the lifetime of the underlying element. Unique within one tree. */
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
  /** Protocol version the SDK implements, e.g. `1.0.0`. */
  readonly protocol: string;
  readonly token: string;
  /** e.g. `@dpad-tv/sdk-react-native@0.1.0` */
  readonly sdk: string;
  /** e.g. `react-native`, `web`, `native-ios` */
  readonly framework: string;
  readonly domains: readonly Domain[];
}

export interface HelloResult {
  /** Protocol version the host implements. */
  readonly protocol: string;
  readonly sessionId: string;
}

export type MediaState =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

/** Every media state, in no particular order. */
export const MEDIA_STATES: readonly MediaState[] = [
  'idle',
  'loading',
  'buffering',
  'playing',
  'paused',
  'ended',
  'error',
];

export interface MediaInfo {
  /** Player id, unique among the app's players. */
  readonly id: string;
  readonly state: MediaState;
  /** Seconds. */
  readonly position: number;
  /** Seconds; `null` for live or unknown. */
  readonly duration: number | null;
  readonly rate: number;
  readonly error?: string;
}

export interface BusyResource {
  /** e.g. `network`, `animation`, `timer`, `navigation`, `interaction`, `state`, `custom` */
  readonly kind: string;
  /** Human readable, e.g. `GET /api/home`. */
  readonly description: string;
  /** How long the resource has been busy, when known. */
  readonly durationMs?: number;
}

/**
 * One focusable node and where focus moves from it per direction.
 * Edge values: node id = focus moves there; `null` = focus does not move (edge of the
 * screen or a trap); absent = unknown (the host falls back to geometry).
 */
export interface FocusGraphNode {
  readonly id: string;
  readonly up?: string | null;
  readonly down?: string | null;
  readonly left?: string | null;
  readonly right?: string | null;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntryParams {
  readonly level: LogLevel;
  readonly message: string;
  /** Milliseconds since the Unix epoch, app clock. */
  readonly timestamp: number;
  /** `console` for console output, `uncaught` for unhandled errors and rejections. */
  readonly kind?: 'console' | 'uncaught';
  readonly stack?: string;
}

export type LaunchFlags = Readonly<Record<string, string | number | boolean>>;

/** Requests sent from host to app. */
export interface HostToAppRequests {
  'tree.get': {
    params: { readonly rootId?: string };
    result: { readonly root: ProtocolNode; readonly viewport: Viewport };
  };
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
  'media.list': { params: Record<string, never>; result: { readonly media: readonly MediaInfo[] } };
  'state.apply': {
    params: { readonly state?: string; readonly flags?: LaunchFlags };
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
  'media.list': 'media',
  'state.apply': 'state',
};

/**
 * Protocol version (`major.minor`) that introduced each host-to-app method. The host never
 * calls a method newer than the SDK's announced minor version.
 */
export const METHOD_SINCE: Readonly<Record<HostToAppMethod, string>> = {
  'tree.get': '1.0',
  'focus.get': '1.0',
  'focus.graph': '1.0',
  'sync.waitForIdle': '1.0',
  'media.get': '1.0',
  'media.list': '1.0',
  'state.apply': '1.0',
};

/** Which domain each app-to-host notification belongs to. */
export const NOTIFICATION_DOMAIN: Readonly<Record<AppToHostNotificationMethod, Domain>> = {
  'focus.changed': 'focus',
  'logs.entry': 'logs',
  'media.changed': 'media',
};

/** WebSocket close codes used by the protocol (4000-4999 is the application range). */
export const CloseCode = {
  /** Normal close (session over). */
  Normal: 1000,
  /** Host shutting down. */
  GoingAway: 1001,
  /** First message was not a valid `dpad.hello`, or it did not arrive in time. */
  HandshakeFailed: 4000,
  /** Token missing, unknown, expired or already used. */
  Unauthorized: 4001,
  /** Protocol major version mismatch. */
  IncompatibleProtocol: 4002,
  /** The peer stopped answering heartbeats. */
  Unresponsive: 4003,
} as const;
