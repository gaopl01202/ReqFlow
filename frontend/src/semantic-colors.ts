import presets from "../../backend/core/color-presets.json";
export function dictionaryColor(kind: string, code = "", name = "") {
  const exact =
    (presets.dictionary as Record<string, Record<string, string>>)[kind] || {};
  return (
    exact[code] ||
    exact[name] ||
    Object.entries(
      (presets.names as Record<string, Record<string, string>>)[kind] || {},
    ).find(([word]) => name.includes(word))?.[1] ||
    (presets.dictionaryDefaults as Record<string, string>)[kind] ||
    "blue"
  );
}
export function workflowColor(
  kind: string,
  code = "",
  category = "pending",
  name = "",
  initial = false,
) {
  if (category === "completed") return "green";
  if (category === "cancelled") return "default";
  if (code === "ready" && kind === "bug") return "orange";
  return (
    (presets.workflowCodes as Record<string, string>)[code] ||
    Object.entries(presets.workflowNames).find(([word]) =>
      name.includes(word),
    )?.[1] ||
    (initial ? "default" : "cyan")
  );
}
