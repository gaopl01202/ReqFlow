// Runtime APIs used by shared renderers are not supplied by Vite's syntax transforms.
// Keep this module first in the entrypoint, before any UI or renderer is evaluated.
if (typeof Object.hasOwn !== "function") {
  Object.defineProperty(Object, "hasOwn", {
    value: (object: unknown, key: PropertyKey): boolean =>
      Object.prototype.hasOwnProperty.call(object, key),
    configurable: true,
    writable: true,
  });
}
