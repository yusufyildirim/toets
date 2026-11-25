---
'@toets/driver-tvos': minor
---

Breaking: remove `focusWaitMs`. The tvOS driver no longer waits for native focus before each press; apps with a JS focus engine paid the full wait on every press. tvOS still drops presses until a new screen holds focus: assert focus on it (`toBeFocused`) before pressing. `TvosSession` no longer needs `getActiveElement`.
