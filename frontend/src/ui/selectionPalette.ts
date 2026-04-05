import type { CSSProperties } from 'react';

export type SelectionTone = 'regex' | 'ner' | 'yolo';

type ToneClasses = {
  headerSurface: string;
  dot: string;
  badgeText: string;
  cardSelected: string;
  cardSelectedCompact: string;
  cardNeutralSelected: string;
  tileSurface: string;
  titleText: string;
  metaText: string;
  descriptionText: string;
  hoverRing: string;
  checkbox: string;
};

const toneClasses: Record<SelectionTone, ToneClasses> = {
  regex: {
    headerSurface: 'border-[var(--selection-regex-border)] bg-[var(--selection-regex-soft)]',
    dot: 'bg-[var(--selection-regex-accent)]',
    badgeText: 'text-[var(--selection-regex-text)]',
    cardSelected: 'border-[var(--selection-regex-border)] bg-[var(--selection-regex-surface)] text-[var(--selection-regex-text)] shadow-sm',
    cardSelectedCompact: 'border-[var(--selection-regex-border)] bg-[var(--selection-regex-surface)] text-[var(--selection-regex-text)]',
    cardNeutralSelected: 'border-[var(--selection-regex-border)] bg-[var(--selection-regex-surface)] text-[var(--selection-regex-text)] shadow-sm',
    tileSurface: 'border-[var(--selection-regex-border)] bg-[var(--selection-regex-soft)]',
    titleText: 'text-[var(--selection-regex-text)]',
    metaText: 'text-[var(--selection-regex-muted)]',
    descriptionText: 'text-[var(--selection-regex-muted)]',
    hoverRing: 'hover:ring-[var(--selection-regex-ring)]',
    checkbox: 'accent-[var(--selection-regex-accent)] focus:ring-[var(--selection-regex-ring)]',
  },
  ner: {
    headerSurface: 'border-[var(--selection-ner-border)] bg-[var(--selection-ner-soft)]',
    dot: 'bg-[var(--selection-ner-accent)]',
    badgeText: 'text-[var(--selection-ner-text)]',
    cardSelected: 'border-[var(--selection-ner-border)] bg-[var(--selection-ner-surface)] text-[var(--selection-ner-text)] shadow-sm',
    cardSelectedCompact: 'border-[var(--selection-ner-border)] bg-[var(--selection-ner-surface)] text-[var(--selection-ner-text)]',
    cardNeutralSelected: 'border-[var(--selection-ner-border)] bg-[var(--selection-ner-surface)] text-[var(--selection-ner-text)] shadow-sm',
    tileSurface: 'border-[var(--selection-ner-border)] bg-[var(--selection-ner-soft)]',
    titleText: 'text-[var(--selection-ner-text)]',
    metaText: 'text-[var(--selection-ner-muted)]',
    descriptionText: 'text-[var(--selection-ner-muted)]',
    hoverRing: 'hover:ring-[var(--selection-ner-ring)]',
    checkbox: 'accent-[var(--selection-ner-accent)] focus:ring-[var(--selection-ner-ring)]',
  },
  yolo: {
    headerSurface: 'border-[var(--selection-yolo-border)] bg-[var(--selection-yolo-soft)]',
    dot: 'bg-[var(--selection-yolo-accent)]',
    badgeText: 'text-[var(--selection-yolo-text)]',
    cardSelected: 'border-[var(--selection-yolo-border)] bg-[var(--selection-yolo-surface)] text-[var(--selection-yolo-text)] shadow-sm',
    cardSelectedCompact: 'border-[var(--selection-yolo-border)] bg-[var(--selection-yolo-surface)] text-[var(--selection-yolo-text)]',
    cardNeutralSelected: 'border-[var(--selection-yolo-border)] bg-[var(--selection-yolo-surface)] text-[var(--selection-yolo-text)] shadow-sm',
    tileSurface: 'border-[var(--selection-yolo-border)] bg-[var(--selection-yolo-soft)]',
    titleText: 'text-[var(--selection-yolo-text)]',
    metaText: 'text-[var(--selection-yolo-muted)]',
    descriptionText: 'text-[var(--selection-yolo-muted)]',
    hoverRing: 'hover:ring-[var(--selection-yolo-ring)]',
    checkbox: 'accent-[var(--selection-yolo-accent)] focus:ring-[var(--selection-yolo-ring)]',
  },
};

export function getSelectionToneClasses(tone: SelectionTone): ToneClasses {
  return toneClasses[tone];
}

export function getSelectionMarkStyle(tone: SelectionTone): CSSProperties {
  return {
    backgroundColor: `var(--selection-${tone}-surface)`,
    color: `var(--selection-${tone}-text)`,
  };
}
