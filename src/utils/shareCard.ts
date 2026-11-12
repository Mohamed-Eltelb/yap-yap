import { HeatmapWeek, InsightsStats, formatDurationParts, formatWordCount } from '../services/stats';

export type ShareTemplate = 'insights' | 'highlights' | 'activity';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function renderShareCardToCanvas(
  template: ShareTemplate,
  stats: InsightsStats,
  weeks: HeatmapWeek[]
): HTMLCanvasElement {
  const width = 960;
  const height = template === 'insights' ? 920 : 540;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Dreamy sky gradient matching screenshot 12
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#c8e4fb');
  grad.addColorStop(0.45, '#e8f3fc');
  grad.addColorStop(0.75, '#f2e8eb');
  grad.addColorStop(1, '#d6eafb');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Soft radial highlight
  const rad = ctx.createRadialGradient(width * 0.5, height * 0.48, 30, width * 0.5, height * 0.48, 420);
  rad.addColorStop(0, 'rgba(255,255,255,0.65)');
  rad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = '#111113';
  ctx.font = '700 44px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  const titleText =
    template === 'insights'
      ? 'My Yap Yap insights'
      : template === 'highlights'
      ? 'My Yap Yap highlights'
      : 'My Yap Yap activity';
  ctx.fillText(titleText, width / 2, 92);

  const wordsFmt = formatWordCount(stats.totalWords);
  const saved = formatDurationParts(stats.timeSavedMinutes);
  const totalTime = formatDurationParts(stats.totalDictationMinutes);

  let cursorY = 140;

  if (template === 'insights' || template === 'highlights') {
    const cards = [
      { value: wordsFmt.value, unit: wordsFmt.unit, label: 'Words dictated' },
      { value: `${saved.hours}`, unit: `hr ${saved.minutes} min`, label: 'Time saved' },
      { value: `${stats.averageWpm}`, unit: 'WPM', label: 'Average dictation speed' },
      { value: `${totalTime.hours}`, unit: `hr ${totalTime.minutes} min`, label: 'Total dictation time' },
    ];

    const padX = 64;
    const gap = 24;
    const cardW = (width - padX * 2 - gap) / 2;
    const cardH = 148;

    cards.forEach((c, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = padX + col * (cardW + gap);
      const y = cursorY + row * (cardH + gap);

      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.06)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
      drawRoundedRect(ctx, x, y, cardW, cardH, 24);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.fill();
      ctx.restore();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#111113';
      ctx.font = '700 42px Inter, system-ui, sans-serif';
      const valWidth = ctx.measureText(c.value).width;
      ctx.fillText(c.value, x + 28, y + 66);

      ctx.font = '600 21px Inter, system-ui, sans-serif';
      ctx.fillText(c.unit, x + 28 + valWidth + 8, y + 66);

      ctx.fillStyle = '#71717a';
      ctx.font = '500 18px Inter, system-ui, sans-serif';
      ctx.fillText(c.label, x + 28, y + 108);
    });

    cursorY += cardH * 2 + gap + 24;
  }

  if (template === 'insights' || template === 'activity') {
    const padX = 64;
    const cardW = width - padX * 2;
    const cardH = 310;

    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.06)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    drawRoundedRect(ctx, padX, cursorY, cardW, cardH, 24);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fill();
    ctx.restore();

    const streakRows = [
      { value: `${stats.activeDays}`, label: 'Active days' },
      { value: `${stats.currentStreak}`, label: 'Current streak' },
      { value: `${stats.longestStreak}`, label: 'Longest streak' },
    ];

    streakRows.forEach((s, i) => {
      const sy = cursorY + 62 + i * 94;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#111113';
      ctx.font = '700 34px Inter, system-ui, sans-serif';
      const vw = ctx.measureText(s.value).width;
      ctx.fillText(s.value, padX + 32, sy);
      ctx.font = '600 18px Inter, system-ui, sans-serif';
      ctx.fillText('days', padX + 32 + vw + 6, sy);
      ctx.fillStyle = '#71717a';
      ctx.font = '500 16px Inter, system-ui, sans-serif';
      ctx.fillText(s.label, padX + 32, sy + 28);
    });

    // Mini heatmap on right side of activity card
    const visibleWeeks = weeks.slice(-14);
    const gridX = padX + 340;
    const gridY = cursorY + 42;
    const cell = 24;
    const cellGap = 8;

    const levelColors = ['#f1f5f9', '#dbeafe', '#93c5fd', '#3b82f6', '#1d64f2'];

    visibleWeeks.forEach((wk, wi) => {
      wk.days.forEach((day, di) => {
        const cx = gridX + wi * (cell + cellGap);
        const cy = gridY + di * (cell + cellGap);
        drawRoundedRect(ctx, cx, cy, cell, cell, 6);
        ctx.fillStyle = day.hatched ? '#f4f4f5' : levelColors[day.level];
        ctx.fill();
      });
    });
  }

  // Footer watermark matching Image 12
  ctx.textAlign = 'left';
  ctx.fillStyle = '#18181b';
  ctx.font = '700 22px Inter, system-ui, sans-serif';
  ctx.fillText('Yap Yap', 64, height - 34);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#52525b';
  ctx.font = '500 18px Inter, system-ui, sans-serif';
  ctx.fillText('yapyap.app', width - 64, height - 34);

  return canvas;
}

export async function copyCanvasImage(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not generate image');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export function downloadCanvasImage(canvas: HTMLCanvasElement, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
