/** An app found on this computer that Yap Yap can import from. */
export interface ImportSource {
  name: string;
  /** The installed app's own icon, when it could be read. */
  icon?: string;
}

/** The apps' own icons, overlapping slightly when there are two. Decorative: the names are written beside them. */
export function OtherAppIcons({ apps, size = 18 }: { apps: ImportSource[]; size?: number }) {
  const icons = apps.filter((app) => app.icon);
  if (!icons.length) return null;
  return (
    <span className="yy-app-icons" aria-hidden="true">
      {icons.map((app) => <img key={app.name} src={app.icon} alt="" width={size} height={size} />)}
    </span>
  );
}
