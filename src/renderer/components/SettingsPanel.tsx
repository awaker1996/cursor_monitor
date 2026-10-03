import type { ReactNode } from 'react';

export type SettingsSectionId = 'accounts' | 'data' | 'ball' | 'icon' | 'about';

interface SettingsPanelProps {
  id: SettingsSectionId;
  title: string;
  description: string;
  active: boolean;
  children: ReactNode;
}
export default function SettingsPanel({
  id,
  title,
  description,
  active,
  children,
}: SettingsPanelProps) {
  return (
    <section
      id={`settings-panel-${id}`}
      className={`settings-panel${active ? ' is-active' : ''}`}
      hidden={!active}
      aria-labelledby={`settings-panel-${id}-title`}
    >
      <header className="settings-panel__header">
        <h2 id={`settings-panel-${id}-title`}>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}
