import type { PersonalizationCategory } from '../types/app';

interface Sector {
  category: PersonalizationCategory;
  percent: number;
}

interface Props {
  sectors: Sector[];
  size?: number;
  activeCategory?: PersonalizationCategory | null;
  onHighlight?: (category: PersonalizationCategory | null) => void;
}

const petals = {
  'AI assistants': { start: -90, end: 122, color: 'var(--personalization-ai)' },
  Messaging: { start: 123, end: 185, color: 'var(--personalization-messaging)' },
  'Social platforms': { start: 186, end: 248, color: 'var(--personalization-social)' },
  'Development tools': { start: 249, end: 269, color: 'var(--personalization-development)' },
} satisfies Record<PersonalizationCategory, { start: number; end: number; color: string }>;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeWedge(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  cornerRadius: number
): string {
  const corner = Math.min(cornerRadius, r * 0.15);
  const inset = Math.min((corner / r) * 180 / Math.PI, (endAngle - startAngle) / 4);
  const point = (radius: number, angle: number) => {
    const { x, y } = polarToCartesian(cx, cy, radius, angle);
    return `${x} ${y}`;
  };
  const largeArc = endAngle - startAngle - 2 * inset > 180 ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${point(r - corner, startAngle)}`,
    `Q ${point(r, startAngle)} ${point(r, startAngle + inset)}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${point(r, endAngle - inset)}`,
    `Q ${point(r, endAngle)} ${point(r - corner, endAngle)}`,
    'Z',
  ].join(' ');
}

export function PersonalizationChart({ sectors, size = 180, activeCategory, onHighlight }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.49;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="yy-personalization-chart block h-auto max-w-full select-none"
      role="img"
      aria-label="Personalization radial chart"
    >
      {sectors.map((sector) => {
        const { start, end, color } = petals[sector.category];
        const innerR = maxR * Math.max(0, Math.min(1, sector.percent / 100));

        return (
          <g
            key={sector.category}
            data-category={sector.category}
            data-highlighted={activeCategory === sector.category}
            onPointerEnter={() => onHighlight?.(sector.category)}
            onPointerLeave={() => onHighlight?.(null)}
          >
            <title>{`${sector.category}: ${sector.percent}%`}</title>
            <path
              d={describeWedge(cx, cy, maxR, start, end, size * 0.03)}
              className="yy-personalization-track"
            />
            {innerR > 0 && <path
              d={describeWedge(cx, cy, innerR, start, end, size * 0.008)}
              fill={color}
              className="yy-personalization-fill"
            />}
          </g>
        );
      })}
    </svg>
  );
}
