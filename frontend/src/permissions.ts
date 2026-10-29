import type { Row } from "./api";
export function canAction(
  user: Row | null,
  menu: string,
  operation: string,
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  if (!user.action_permissions) return false;
  return (
    user.action_permissions.includes(`${menu}:${operation}`) &&
    (!user.menu_permissions || user.menu_permissions.includes(menu))
  );
}
