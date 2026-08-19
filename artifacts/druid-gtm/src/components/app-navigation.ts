export interface AppNavigationItem {
  path: string;
  label: string;
}

export function isAppNavigationItemActive(
  location: string,
  path: string,
): boolean {
  const pathname = location.split("?")[0] || "/";
  if (path === "/dashboard") {
    return pathname === "/" || pathname === "/dashboard";
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function activeAppNavigationLabel(
  location: string,
  items: readonly AppNavigationItem[],
): string {
  return (
    items.find((item) => isAppNavigationItemActive(location, item.path))?.label ??
    "Mission Control"
  );
}
