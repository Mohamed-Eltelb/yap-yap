interface Sector {
  category: string;
  percent: number;
  count: number;
}

interface Props {
  sectors: Sector[];
  size?: number;
  activeCategory?: string | null;
  onHighlight?: (category: string | null) => void;
}

const colors = [
  'var(--personalization-ai)',
  'var(--personalization-messaging)',
  'var(--personalization-social)',
  'var(--personalization-development)',
];

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

  // Wedge width follows how much the category is used; fill radius follows its personalization.
  const total = sectors.reduce((sum, sector) => sum + sector.count, 0) || 1;
  const minAngle = Math.min(14, 360 / Math.max(sectors.length, 1));
  const spare = 360 - minAngle * sectors.length;
  let cursor = -90;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="yy-personalization-chart block h-auto max-w-full select-none"
      role="img"
      aria-label="Personalization radial chart"
    >
      {!sectors.length && <circle cx={cx} cy={cy} r={maxR} className="yy-personalization-track" />}
      {sectors.map((sector, index) => {
        const angle = minAngle + spare * sector.count / total;
        const start = cursor;
        const end = start + angle - Math.min(2, angle / 6);
        cursor += angle;
        const color = colors[index % colors.length];
        const innerR = maxR * Math.max(0, Math.min(1, sector.percent / 100));

        return (
          <g
            key={sector.category}
            data-category={sector.category}
            data-highlighted={activeCategory === sector.category}
            onPointerEnter={onHighlight && (() => onHighlight(sector.category))}
            onPointerLeave={onHighlight && (() => onHighlight(null))}
          >
            {onHighlight && <title>{`${sector.category}: ${sector.percent}% personalized`}</title>}
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
