import { HeatmapWeek, InsightsStats, formatDurationParts, formatWordCount } from '../services/stats';

export type ShareTemplate = 'insights' | 'highlights' | 'activity';

/**
 * Shared layout for the share card. The on-screen card (ShareCard.tsx) and the
 * exported PNG (renderShareCardToCanvas) both read these numbers so the image
 * people copy looks like the preview they saw.
 */
export const CARD = {
  width: 600,
  radius: 20,
  padTop: 22,
  padX: 24,
  padBottom: 18,
  titleSize: 46,
  titleGap: 18,
  statH: 92,
  gap: 12,
  activityH: 196,
  footerGap: 18,
  footerH: 22,
  heatWeeks: 13,
  cell: 14,
  cellGap: 7,
  dayLabelW: 16,
} as const;

export const TITLE_FONT = "'Bricolage Grotesque', 'Inter', system-ui, sans-serif";
export const BODY_FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";

export const HEAT_COLORS = ['#eef1fd', '#d3defc', '#9db6f8', '#4f7df3', '#2f66f0'];
export const HEAT_EMPTY = '#f4f4f5';

export function showsStats(t: ShareTemplate) {
  return t !== 'activity';
}
export function showsActivity(t: ShareTemplate) {
  return t !== 'highlights';
}

export function cardTitle(t: ShareTemplate) {
  return t === 'insights' ? 'My Yap Yap insights' : t === 'highlights' ? 'My Yap Yap highlights' : 'My Yap Yap activity';
}

export function cardHeight(t: ShareTemplate, withTitle = true) {
  let h = CARD.padTop + (withTitle ? CARD.titleSize + CARD.titleGap : 4);
  if (showsStats(t)) h += CARD.statH * 2 + CARD.gap;
  if (showsStats(t) && showsActivity(t)) h += CARD.gap;
  if (showsActivity(t)) h += CARD.activityH;
  return h + CARD.footerGap + CARD.footerH + CARD.padBottom;
}

/** A soft blurred blob in the card backdrop; x/y/rx/ry are fractions of the card. */
interface BackdropBlob {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
}

interface Backdrop {
  base: [string, string, string];
  blobs: BackdropBlob[];
}

export const BACKDROPS: Record<ShareTemplate, Backdrop> = {
  insights: {
    base: ['#d3e5f4', '#edf2f6', '#dbe8f2'],
    blobs: [
      { x: 0.12, y: 0.08, rx: 0.45, ry: 0.3, color: 'rgba(190, 216, 240, 0.9)' },
      { x: 0.5, y: 0.42, rx: 0.13, ry: 0.5, color: 'rgba(196, 158, 132, 0.55)' },
      { x: 0.42, y: 0.3, rx: 0.08, ry: 0.22, color: 'rgba(140, 150, 170, 0.35)' },
      { x: 0.82, y: 0.72, rx: 0.4, ry: 0.35, color: 'rgba(250, 250, 252, 0.85)' },
      { x: 0.2, y: 0.85, rx: 0.35, ry: 0.25, color: 'rgba(225, 235, 244, 0.9)' },
    ],
  },
  highlights: {
    base: ['#e6e2e0', '#efecea', '#e2dfde'],
    blobs: [
      { x: 0.5, y: 0.5, rx: 0.28, ry: 0.65, color: 'rgba(150, 140, 140, 0.35)' },
      { x: 0.5, y: 0.6, rx: 0.08, ry: 0.3, color: 'rgba(170, 40, 40, 0.45)' },
      { x: 0.15, y: 0.2, rx: 0.35, ry: 0.4, color: 'rgba(245, 243, 242, 0.9)' },
      { x: 0.85, y: 0.8, rx: 0.35, ry: 0.4, color: 'rgba(240, 238, 237, 0.9)' },
    ],
  },
  activity: {
    base: ['#d9e6f0', '#eef1f3', '#e4e8ec'],
    blobs: [
      { x: 0.45, y: 0.35, rx: 0.16, ry: 0.55, color: 'rgba(196, 160, 132, 0.5)' },
      { x: 0.62, y: 0.2, rx: 0.1, ry: 0.3, color: 'rgba(150, 120, 100, 0.3)' },
      { x: 0.1, y: 0.15, rx: 0.4, ry: 0.35, color: 'rgba(205, 225, 242, 0.9)' },
      { x: 0.85, y: 0.85, rx: 0.4, ry: 0.35, color: 'rgba(246, 247, 249, 0.9)' },
    ],
  },
};

export function backdropCss(t: ShareTemplate): string {
  const b = BACKDROPS[t];
  const blobs = b.blobs.map(
    (bl) =>
      `radial-gradient(ellipse ${bl.rx * 100}% ${bl.ry * 100}% at ${bl.x * 100}% ${bl.y * 100}%, ${bl.color}, transparent 100%)`
  );
  return [...blobs, `linear-gradient(135deg, ${b.base[0]}, ${b.base[1]} 50%, ${b.base[2]})`].join(', ');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function whiteCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.05)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

/** Draws "value unit value unit" with the big/small sizes used on the card. */
function valueRun(ctx: CanvasRenderingContext2D, parts: [string, boolean][], x: number, y: number, big: number, small: number) {
  let cx = x;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111113';
  parts.forEach(([text, isBig], i) => {
    ctx.font = `700 ${isBig ? big : small}px ${TITLE_FONT}`;
    ctx.fillText(text, cx, y);
    cx += ctx.measureText(text).width + (i < parts.length - 1 ? (isBig ? 5 : 7) : 0);
  });
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const p = new Path2D(
    'M5.5 5.2C11.4 4.2 17.5 6.9 19.2 12.2C19.8 14.2 19.3 16.5 17.8 18.2C16.2 19.9 13.7 20.3 11.7 19.1C10.5 18.4 9.7 17.1 9.5 15.6C9.3 13.7 10.6 11.9 12.5 11.4C13.7 11.1 14.9 11.7 15.4 12.7C14.1 12.6 12.9 13.5 12.7 14.8C12.6 15.9 13.4 16.9 14.5 17C15.8 17.1 16.7 15.8 16.4 14.2C15.9 11.1 12.8 8.9 8.7 8.8C7.1 8.8 5.7 9.2 4.6 9.8C4.4 8.1 4.7 6.4 5.5 5.2Z'
  );
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = '#111113';
  ctx.fill(p);
  ctx.restore();
}

export function statParts(stats: InsightsStats) {
  const words = formatWordCount(stats.totalWords);
  const saved = formatDurationParts(stats.timeSavedMinutes);
  const total = formatDurationParts(stats.totalDictationMinutes);
  const dur = (d: typeof saved): [string, boolean][] => [
    [`${d.firstVal}`, true],
    [d.firstUnit, false],
    [`${d.secondVal}`, true],
    [d.secondUnit, false],
  ];
  return [
    { parts: [[words.value, true], [words.unit, false]] as [string, boolean][], label: 'Words dictated' },
    { parts: dur(saved), label: 'Time saved' },
    { parts: [[`${stats.averageWpm}`, true], ['WPM', false]] as [string, boolean][], label: 'Average dictation speed' },
    { parts: dur(total), label: 'Total dictation time' },
  ];
}

export async function renderShareCardToCanvas(
  template: ShareTemplate,
  stats: InsightsStats,
  weeks: HeatmapWeek[]
): Promise<HTMLCanvasElement> {
  try {
    await document.fonts.load(`700 46px 'Bricolage Grotesque'`);
  } catch {
    /* fall back to Inter */
  }

  const scale = 2;
  const W = CARD.width;
  const H = cardHeight(template);
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // Backdrop: base gradient, soft blobs, then a light grain.
  const bd = BACKDROPS[template];
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, bd.base[0]);
  base.addColorStop(0.5, bd.base[1]);
  base.addColorStop(1, bd.base[2]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  [...bd.blobs].reverse().forEach((b) => {
    ctx.save();
    ctx.translate(b.x * W, b.y * H);
    ctx.scale(b.rx * W, b.ry * H);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, b.color);
    g.addColorStop(1, b.color.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // Title
  let y = CARD.padTop;
  ctx.fillStyle = '#111113';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${CARD.titleSize}px ${TITLE_FONT}`;
  ctx.fillText(cardTitle(template), W / 2, y + CARD.titleSize * 0.82);
  y += CARD.titleSize + CARD.titleGap;

  const innerW = W - CARD.padX * 2;

  if (showsStats(template)) {
    const cw = (innerW - CARD.gap) / 2;
    statParts(stats).forEach((s, i) => {
      const x = CARD.padX + (i % 2) * (cw + CARD.gap);
      const cy = y + Math.floor(i / 2) * (CARD.statH + CARD.gap);
      whiteCard(ctx, x, cy, cw, CARD.statH);
      valueRun(ctx, s.parts, x + 18, cy + 40, 28, 15);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7a7a82';
      ctx.font = `400 13px ${BODY_FONT}`;
      ctx.fillText(s.label, x + 18, cy + 72);
    });
    y += CARD.statH * 2 + CARD.gap;
    if (showsActivity(template)) y += CARD.gap;
  }

  if (showsActivity(template)) {
    whiteCard(ctx, CARD.padX, y, innerW, CARD.activityH);
    const rows = [
      { v: stats.activeDays, l: 'Active days' },
      { v: stats.currentStreak, l: 'Current streak' },
      { v: stats.longestStreak, l: 'Longest streak' },
    ];
    rows.forEach((r, i) => {
      const ry = y + 22 + i * 58;
      valueRun(ctx, [[`${r.v}`, true], ['days', false]], CARD.padX + 24, ry + 22, 24, 13);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7a7a82';
      ctx.font = `400 12.5px ${BODY_FONT}`;
      ctx.fillText(r.l, CARD.padX + 24, ry + 44);
    });

    const vis = weeks.slice(-CARD.heatWeeks);
    const gridW = CARD.dayLabelW + vis.length * CARD.cell + (vis.length - 1) * CARD.cellGap;
    const gridH = 7 * CARD.cell + 6 * CARD.cellGap;
    const gx = CARD.padX + innerW - 22 - gridW;
    const gy = y + (CARD.activityH - gridH - 18) / 2;
    ctx.fillStyle = '#8a8a92';
    ctx.font = `500 9px ${BODY_FONT}`;
    ctx.textAlign = 'left';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d, i) => {
      ctx.fillText(d, gx, gy + i * (CARD.cell + CARD.cellGap) + 10.5);
    });
    vis.forEach((wk, wi) => {
      const cx = gx + CARD.dayLabelW + wi * (CARD.cell + CARD.cellGap);
      wk.days.forEach((day, di) => {
        const cy = gy + di * (CARD.cell + CARD.cellGap);
        roundRect(ctx, cx, cy, CARD.cell, CARD.cell, 3.5);
        if (day.future) {
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#e4e4e7';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.fillStyle = day.hatched ? HEAT_EMPTY : HEAT_COLORS[day.level];
          ctx.fill();
        }
      });
      if (wk.monthLabel && wi > 0) {
        ctx.fillStyle = '#8a8a92';
        ctx.font = `500 9px ${BODY_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(wk.monthLabel, cx + CARD.cell / 2, gy + gridH + 14);
      }
    });
    y += CARD.activityH;
  }

  // Footer
  y += CARD.footerGap;
  drawLogo(ctx, CARD.padX - 1, y + 1, 20);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111113';
  ctx.font = `700 18px ${TITLE_FONT}`;
  ctx.fillText('Yap Yap', CARD.padX + 22, y + 17);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6b6b73';
  ctx.font = `400 14px ${BODY_FONT}`;
  ctx.fillText('yapyap-app.vercel.app', W - CARD.padX, y + 16);

  // Clip to the rounded card shape.
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const octx = out.getContext('2d')!;
  octx.scale(scale, scale);
  roundRect(octx, 0, 0, W, H, CARD.radius);
  octx.clip();
  octx.drawImage(canvas, 0, 0, W, H);
  return out;
}

export async function copyCanvasImage(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) throw new Error('Could not generate image');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export function downloadCanvasImage(canvas: HTMLCanvasElement, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
