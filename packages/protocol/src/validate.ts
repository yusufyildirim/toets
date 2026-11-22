/**
 * Runtime shape checks for protocol messages. Each validator returns a list of problems
 * (empty = valid) with a JSON-path-like location, so failures are self-explaining.
 */
import { DOMAINS, MEDIA_STATES } from './messages.js';
import { parseProtocolVersion } from './version.js';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function checkOptionalString(o: Obj, key: string, path: string, out: string[]): void {
  if (o[key] !== undefined && typeof o[key] !== 'string') out.push(`${path}.${key} must be a string`);
}

export function validateHelloParams(value: unknown): string[] {
  const out: string[] = [];
  if (!isObj(value)) return ['params must be an object'];
  if (!parseProtocolVersion(value.protocol)) out.push('params.protocol must be a semver string');
  if (typeof value.token !== 'string' || !value.token) out.push('params.token must be a non-empty string');
  if (typeof value.sdk !== 'string' || !value.sdk) out.push('params.sdk must be a non-empty string');
  if (typeof value.framework !== 'string' || !value.framework)
    out.push('params.framework must be a non-empty string');
  if (!Array.isArray(value.domains) || value.domains.some((d) => typeof d !== 'string'))
    out.push('params.domains must be an array of strings');
  return out;
}

/** Domains in a hello that this protocol version does not know (allowed, but ignored). */
export function unknownDomains(domains: readonly unknown[]): string[] {
  return domains.filter((d) => !(DOMAINS as readonly unknown[]).includes(d)).map(String);
}

export function validateRect(value: unknown, path: string): string[] {
  if (!isObj(value)) return [`${path} must be an object`];
  const out: string[] = [];
  for (const k of ['x', 'y', 'width', 'height']) {
    if (!isNum(value[k])) out.push(`${path}.${k} must be a finite number`);
  }
  if (isNum(value.width) && value.width < 0) out.push(`${path}.width must be >= 0`);
  if (isNum(value.height) && value.height < 0) out.push(`${path}.height must be >= 0`);
  return out;
}

export function validateViewport(value: unknown, path = 'viewport'): string[] {
  if (!isObj(value)) return [`${path} must be an object`];
  const out: string[] = [];
  if (!isNum(value.width) || value.width <= 0) out.push(`${path}.width must be a positive number`);
  if (!isNum(value.height) || value.height <= 0) out.push(`${path}.height must be a positive number`);
  if (value.pixelRatio !== undefined && (!isNum(value.pixelRatio) || value.pixelRatio <= 0))
    out.push(`${path}.pixelRatio must be a positive number`);
  return out;
}

/** Validates a node and its whole subtree, including id uniqueness and single focus. */
export function validateNodeTree(value: unknown, path = 'root'): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  let focused = 0;
  const visit = (node: unknown, p: string): void => {
    if (!isObj(node)) {
      out.push(`${p} must be an object`);
      return;
    }
    if (typeof node.id !== 'string' || !node.id) out.push(`${p}.id must be a non-empty string`);
    else if (ids.has(node.id)) out.push(`${p}.id "${node.id}" is not unique`);
    else ids.add(node.id);
    checkOptionalString(node, 'testId', p, out);
    checkOptionalString(node, 'text', p, out);
    checkOptionalString(node, 'label', p, out);
    checkOptionalString(node, 'role', p, out);
    out.push(...validateRect(node.bounds, `${p}.bounds`));
    for (const k of ['visible', 'focusable', 'focused', 'enabled', 'selected', 'busy']) {
      if (typeof node[k] !== 'boolean') out.push(`${p}.${k} must be a boolean`);
    }
    if (node.focused === true) focused++;
    if (!Array.isArray(node.children)) {
      out.push(`${p}.children must be an array`);
      return;
    }
    node.children.forEach((c, i) => visit(c, `${p}.children[${i}]`));
  };
  visit(value, path);
  if (focused > 1) out.push(`${path}: ${focused} nodes report focused=true (at most one allowed)`);
  return out;
}

export function validateMediaInfo(value: unknown, path = 'media'): string[] {
  if (!isObj(value)) return [`${path} must be an object`];
  const out: string[] = [];
  if (typeof value.id !== 'string' || !value.id) out.push(`${path}.id must be a non-empty string`);
  if (!(MEDIA_STATES as readonly unknown[]).includes(value.state))
    out.push(`${path}.state must be one of ${MEDIA_STATES.join(', ')}`);
  if (!isNum(value.position) || value.position < 0) out.push(`${path}.position must be a number >= 0`);
  if (value.duration !== null && (!isNum(value.duration) || value.duration < 0))
    out.push(`${path}.duration must be a number >= 0 or null`);
  if (!isNum(value.rate)) out.push(`${path}.rate must be a finite number`);
  checkOptionalString(value, 'error', path, out);
  return out;
}

export function validateBusyResources(value: unknown, path = 'busy'): string[] {
  if (!Array.isArray(value)) return [`${path} must be an array`];
  const out: string[] = [];
  value.forEach((r, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(r)) {
      out.push(`${p} must be an object`);
      return;
    }
    if (typeof r.kind !== 'string' || !r.kind) out.push(`${p}.kind must be a non-empty string`);
    if (typeof r.description !== 'string') out.push(`${p}.description must be a string`);
    if (r.durationMs !== undefined && (!isNum(r.durationMs) || r.durationMs < 0))
      out.push(`${p}.durationMs must be a number >= 0`);
  });
  return out;
}

export function validateFocusGraph(value: unknown, path = 'nodes'): string[] {
  if (!Array.isArray(value)) return [`${path} must be an array`];
  const out: string[] = [];
  const ids = new Set<string>();
  value.forEach((n, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(n)) {
      out.push(`${p} must be an object`);
      return;
    }
    if (typeof n.id !== 'string' || !n.id) out.push(`${p}.id must be a non-empty string`);
    else if (ids.has(n.id)) out.push(`${p}.id "${n.id}" is not unique`);
    else ids.add(n.id);
    for (const dir of ['up', 'down', 'left', 'right']) {
      const v = n[dir];
      if (v !== undefined && v !== null && typeof v !== 'string')
        out.push(`${p}.${dir} must be a node id, null or absent`);
    }
  });
  return out;
}

export function validateLogEntry(value: unknown, path = 'params'): string[] {
  if (!isObj(value)) return [`${path} must be an object`];
  const out: string[] = [];
  if (!['debug', 'info', 'warn', 'error'].includes(value.level as string))
    out.push(`${path}.level must be debug, info, warn or error`);
  if (typeof value.message !== 'string') out.push(`${path}.message must be a string`);
  if (!isNum(value.timestamp)) out.push(`${path}.timestamp must be a number (epoch ms)`);
  if (value.kind !== undefined && value.kind !== 'console' && value.kind !== 'uncaught')
    out.push(`${path}.kind must be console or uncaught`);
  checkOptionalString(value, 'stack', path, out);
  return out;
}

export function validateFocusChanged(value: unknown, path = 'params'): string[] {
  if (!isObj(value)) return [`${path} must be an object`];
  const out: string[] = [];
  for (const k of ['from', 'to']) {
    if (value[k] !== null && typeof value[k] !== 'string') out.push(`${path}.${k} must be a node id or null`);
  }
  return out;
}
