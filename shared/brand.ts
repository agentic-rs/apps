export function setAppIcon(icon_url: string): void {
  const link =
    document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ?? document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = icon_url;
  if (!link.isConnected) document.head.append(link);
}
