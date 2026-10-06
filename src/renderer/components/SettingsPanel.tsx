import type { ReactNode } from 'react';

export type SettingsSectionId = 'accounts' | 'data' | 'appearance' | 'about';

interface SettingsPanelProps {
  id: SettingsSectionId;
  title: string;
  description: string;
  active: boolean;
  /** 单卡面板（如「关于」）：卡片纵向铺满面板区剩余高度。 */
  fill?: boolean;
  children: ReactNode;
}
export default function SettingsPanel({
  id,
  title,
  description,
  active,
  fill,
  children,
}: SettingsPanelProps) {
  return (
    <section
      id={`settings-panel-${id}`}
      className={`settings-panel${active ? ' is-active' : ''}${fill ? ' settings-panel--fill' : ''}`}
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
