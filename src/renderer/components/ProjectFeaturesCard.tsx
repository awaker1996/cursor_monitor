import type { ReactNode } from 'react';
import readmeSource from '../../../README.md?raw';
import pkg from '../../../package.json';
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

const INTRO = extractIntro().trim();

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

/**
 * 一条要点拆成「标题 / 说明」两段。
 * README 的「范围内」清单按「标题：说明」书写，此处按首个中文冒号拆分；
 * 没有冒号时整条作为标题。
 */
interface FeatureEntry {
  title: string;
  detail: string;
}

function splitFeature(bullet: string): FeatureEntry {
  const text = bullet.trim();
  const colon = text.indexOf('：');
  if (colon > 0) {
    return { title: text.slice(0, colon).trim(), detail: text.slice(colon + 1).trim() };
  }
  return { title: text, detail: '' };
}

const FEATURES: FeatureEntry[] = extractBullets('**范围内：**', ['**范围外：**']).map(splitFeature);

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
  if (!INTRO && FEATURES.length === 0) return null;

  return (
    <GlassCard>
      <div className="set-card__body project-features">
        <header className="project-features__lead">
          <span className="project-features__mark" aria-hidden>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="10" cy="10" r="3" />
              <path
                d="M10 2.4v2.3M10 15.3v2.3M2.4 10h2.3M15.3 10h2.3M4.6 4.6l1.6 1.6M13.8 13.8l1.6 1.6M15.4 4.6l-1.6 1.6M6.2 13.8l-1.6 1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div className="project-features__lead-text">
            <span className="project-features__title">Cursor Token Monitor</span>
            {INTRO && <p className="project-features__intro">{renderInline(INTRO)}</p>}
          </div>
        </header>

        <ul className="project-features__grid">
          {FEATURES.map((feature, index) => (
            <li className="feature-item" key={`${feature.title}-${index}`}>
              <div className="feature-item__head">
                <span className="feature-item__mark" aria-hidden>
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path
                      d="M2.4 6.2 4.7 8.5 9.6 3.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="feature-item__title">{renderInline(feature.title)}</span>
              </div>
              {feature.detail && (
                <p className="feature-item__text">{renderInline(feature.detail)}</p>
              )}
            </li>
          ))}
        </ul>

        <footer className="project-features__foot">
          <span>凭据与数据仅保存在本机</span>
          <span className="project-features__version">v{pkg.version}</span>
        </footer>
      </div>
    </GlassCard>
  );
}
