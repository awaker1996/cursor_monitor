import type { ReactNode } from 'react';
import readmeSource from '../../../README.md?raw';
import { GlassCard } from './SettingsTabContent';

const README_LINES = readmeSource.split(/\r?\n/);

function extractIntro(): string {
  const parts: string[] = [];
  for (const line of README_LINES) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) {
      parts.push(trimmed.replace(/^>\s?/, ''));
      continue;
    }
    if (parts.length > 0) break;
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    break;
  }
  return parts.filter(Boolean).join(' ');
}

const INTRO = extractIntro()
  .replace(
    /设置窗口为单页设置中心，包含账户与订阅、运行行为与外观两个功能区。?/,
    '设置窗口采用侧边导航 + 分区面板，按「账户与订阅 / 数据刷新 / 悬浮球 / 应用图标」组织。',
  )
  .trim();

function extractBullets(startMarker: string, stopMarkers: string[]): string[] {
  const start = README_LINES.findIndex((line) => line.trim() === startMarker);
  if (start === -1) return [];

  const bullets: string[] = [];
  for (let i = start + 1; i < README_LINES.length; i += 1) {
    const line = README_LINES[i].trim();
    if (stopMarkers.includes(line)) break;
    if (line.startsWith('- ')) bullets.push(line.slice(2).trim());
  }
  return bullets;
}

const FEATURES = extractBullets('**范围内：**', ['**范围外：**']);

/** README 中部分描述与当前实现脱节，此处按当前 UI 修正。 */
const FEATURE_OVERRIDES: Record<string, string> = {
  '设置窗口单页设置中心：账户与订阅（高频）+ 运行行为与外观（低频），无 Tab 切换':
    '设置窗口采用侧边导航 + 分区面板：账户与订阅、数据刷新、悬浮球、应用图标各自独立成页',
};

const FEATURES_DISPLAY = FEATURES.map((f) => FEATURE_OVERRIDES[f] ?? f);

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_PATTERN).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export default function ProjectFeaturesCard() {
  if (!INTRO && FEATURES_DISPLAY.length === 0) return null;

  return (
    <GlassCard accent="about">
      <div className="set-card__body project-features">
        {INTRO && <p className="project-features__intro">{renderInline(INTRO)}</p>}
        <ul className="project-features__list">
          {FEATURES_DISPLAY.map((feature) => (
            <li key={feature}>{renderInline(feature)}</li>
          ))}
        </ul>
      </div>
    </GlassCard>
  );
}
