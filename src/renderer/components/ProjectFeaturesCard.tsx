import type { ReactNode } from 'react';
import readmeSource from '../../../README.md?raw';

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

const INTRO = extractIntro();

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
    <section className="settings-section settings-section--wide">
      <h2>核心功能</h2>
      <div className="project-features">
        {INTRO && <p className="project-features__intro">{renderInline(INTRO)}</p>}
        <ul className="project-features__list">
          {FEATURES.map((feature) => (
            <li key={feature}>{renderInline(feature)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
