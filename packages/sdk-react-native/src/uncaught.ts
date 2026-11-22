import { getGlobal, type Dpad } from '@dpad-tv/sdk';

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler | undefined;
  setGlobalHandler(handler: GlobalHandler): void;
}

/**
 * Forwards uncaught JS errors (React Native's `ErrorUtils` global handler) as `uncaught`
 * log entries, then calls the previous handler (red box, crash reporter). Returns a
 * function that restores the previous handler.
 */
export function trackUncaughtErrors(dpad: Dpad): () => void {
  const errorUtils = getGlobal().ErrorUtils as ErrorUtilsLike | undefined;
  if (
    !errorUtils ||
    typeof errorUtils.getGlobalHandler !== 'function' ||
    typeof errorUtils.setGlobalHandler !== 'function'
  )
    return () => {};
  const previous = errorUtils.getGlobalHandler();
  const handler: GlobalHandler = (error, isFatal) => {
    try {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      dpad.log(
        'error',
        `${isFatal ? 'Fatal' : 'Uncaught'} ${message}`,
        stack ? { kind: 'uncaught', stack } : { kind: 'uncaught' },
      );
    } catch {
      // never get in the way of the app's own handler
    }
    if (previous) previous(error, isFatal);
  };
  errorUtils.setGlobalHandler(handler);
  return () => {
    if (errorUtils.getGlobalHandler() === handler && previous)
      errorUtils.setGlobalHandler(previous);
  };
}
