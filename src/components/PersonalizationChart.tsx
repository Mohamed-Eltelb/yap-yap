interface Sector {
  label: string;
  percent: number;
  color: string;
}

interface Props {
  sectors: Sector[];
  size?: number;
}

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
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    'M',
    cx,
    cy,
    'L',
    start.x,
    start.y,
    'A',
    r,
    r,
    0,
    largeArc,
    0,
    end.x,
    end.y,
    'Z',
  ].join(' ');
}

export function PersonalizationChart({ sectors, size = 180 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.46;

  // Match the asymmetric/balanced radial proportions seen in Screenshots 1, 7, 13
  const defaultAngles = [
    [-92, 128], // large top/right sector (AI assistants)
    [131, 186], // bottom-right sector (Messaging)
    [189, 250], // bottom-left sector (Social platforms)
    [253, 268], // thin left-mid sector (Development tools)
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="overflow-visible select-none"
      aria-label="Personalization radial chart"
    >
      {sectors.map((sector, idx) => {
        const [start, end] = defaultAngles[idx % defaultAngles.length];
        // Scale inner colored petal visibly even at low percentages (like 9.6% -> ~22% radius)
        const normalized = Math.max(0.08, Math.min(1, sector.percent / 100));
        const innerR = Math.max(10, maxR * Math.pow(normalized, 0.55));

        return (
          <g key={sector.label}>
            <path
              d={describeWedge(cx, cy, maxR, start, end)}
              fill="var(--radial-track)"
              className="transition-opacity duration-200 hover:opacity-90"
            />
            <path
              d={describeWedge(cx, cy, innerR, start, end)}
              fill={sector.color}
              className="transition-all duration-300"
            >
              <title>{`${sector.label}: ${sector.percent}%`}</title>
            </path>
          </g>
        );
      })}
    </svg>
  );
}
