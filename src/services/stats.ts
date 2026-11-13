import {
  DictationMode,
  HistoryItem,
  PersonalizationCategory,
  RetentionPolicy,
} from '../types/app';

export interface InsightsStats {
  totalWords: number;
  formattedWords: string;
  timeSavedMinutes: number;
  timeSavedSeconds: number;
  averageWpm: number;
  totalDictationMinutes: number;
  totalDictationSeconds: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  personalizationPercent: number;
  categoryBreakdown: {
    category: PersonalizationCategory;
    percent: number;
    count: number;
  }[];
}

export interface HeatmapCell {
  dateKey: string; // YYYY-MM-DD
  date: Date;
  words: number;
  sessions: number;
  level: 0 | 1 | 2 | 3 | 4;
  hatched: boolean;
  label: string;
  usageLabel: string;
}

export interface HeatmapWeek {
  days: HeatmapCell[];
  monthLabel?: string;
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function formatWordCount(words: number): { value: string; unit: string } {
  if (words >= 1_000_000) {
    return { value: `${(words / 1_000_000).toFixed(1)}M`, unit: 'words' };
  }
  if (words >= 1_000) {
    return { value: `${(words / 1_000).toFixed(1)}K`, unit: 'words' };
  }
  return { value: `${words}`, unit: words === 1 ? 'word' : 'words' };
}

export function formatDurationParts(totalMinutes: number): {
  hours: number;
  minutes: number;
  firstVal: number;
  firstUnit: 'hr' | 'min';
  secondVal: number;
  secondUnit: 'min' | 'sec';
} {
  const totalSeconds = Math.max(0, Math.round(totalMinutes * 60));
  if (totalSeconds === 0) {
    return {
      hours: 0,
      minutes: 0,
      firstVal: 0,
      firstUnit: 'hr',
      secondVal: 0,
      secondUnit: 'min',
    };
  }
  if (totalSeconds < 60) {
    return {
      hours: 0,
      minutes: 0,
      firstVal: 0,
      firstUnit: 'min',
      secondVal: totalSeconds,
      secondUnit: 'sec',
    };
  }
  const roundedMinutes = Math.max(1, Math.round(totalMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return {
    hours,
    minutes,
    firstVal: hours,
    firstUnit: 'hr',
    secondVal: minutes,
    secondUnit: 'min',
  };
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function classifyTranscriptCategory(
  text: string,
  mode: DictationMode
): PersonalizationCategory {
  if (mode === 'ask') return 'AI assistants';
  const lower = text.toLowerCase();

  if (
    /\b(git|npm|yarn|pnpm|docker|api|json|cli|bug|deploy|commit|pull request|typescript|javascript|python|rust|react|database|sql|endpoint|localhost|terminal|cursor|vscode|webpack|vite|refactor)\b/.test(
      lower
    ) ||
    /[a-z]+[A-Z][a-zA-Z]+/.test(text) ||
    /\.(ts|tsx|js|py|rs|go|json|md|yml|sh)\b/.test(lower)
  ) {
    return 'Development tools';
  }

  if (
    /\b(post|tweet|thread|twitter|reddit|linkedin|instagram|youtube|tiktok|caption|followers|subscribers|hashtag|viral)\b/.test(
      lower
    ) ||
    /#[a-zA-Z0-9_]+/.test(text)
  ) {
    return 'Social platforms';
  }

  if (
    /^(explain|summarize|write|generate|draft|refactor|analyze|translate|compare|list|how do i|what is|can you)\b/i.test(
      text.trim()
    )
  ) {
    return 'AI assistants';
  }

  return 'Messaging';
}

export function extractAutoDictionaryWords(
  text: string,
  existingWords: string[]
): string[] {
  const existingSet = new Set(existingWords.map((w) => w.toLowerCase()));
  const candidates = new Set<string>();

  // 1. Domain names / tech hosts (e.g., apivault.tech, github.com)
  const domains = text.match(/\b[a-zA-Z0-9-]+\.(tech|io|ai|dev|app|com|org|net)\b/g) ?? [];
  for (const d of domains) candidates.add(d);

  // 2. CamelCase or mixed-case identifiers (e.g., RecyclePen, TypeScript, OpenAI)
  const camelTokens = text.match(/\b[A-Za-z]+[a-z][A-Z][A-Za-z0-9]*\b/g) ?? [];
  for (const c of camelTokens) candidates.add(c);

  return Array.from(candidates).filter(
    (w) => w.length >= 3 && !existingSet.has(w.toLowerCase())
  );
}

export function filterByRetention(
  items: HistoryItem[],
  policy: RetentionPolicy,
  now = new Date()
): HistoryItem[] {
  if (policy === 'forever') return items;
  if (policy === 'never') return [];
  const days = { '1y': 365, '90d': 90, '30d': 30, '7d': 7, '24h': 1 }[policy] ?? 7;
  const cutoff = now.getTime() - days * 86_400_000;
  return items.filter((item) => new Date(item.createdAt).getTime() >= cutoff);
}

export function computeInsights(
  items: HistoryItem[],
  dictionaryCount: number,
  now = new Date()
): InsightsStats {
  const totalWords = items.reduce((sum, item) => sum + item.wordCount, 0);
  const totalDurationMs = items.reduce((sum, item) => sum + item.durationMs, 0);
  const totalDictationSeconds = Math.round(totalDurationMs / 1000);
  const totalDictationMinutes = totalDurationMs / 60_000;

  // Baseline average typing speed = 40 WPM (1.5 seconds per word)
  const typingEquivalentMinutes = totalWords / 40;
  const timeSavedMinutes = Math.max(0, typingEquivalentMinutes - totalDictationMinutes);
  const timeSavedSeconds = Math.max(
    0,
    Math.round(typingEquivalentMinutes * 60 - totalDictationSeconds)
  );

  const averageWpm =
    totalDurationMs > 0 && totalWords > 0
      ? Math.round(totalWords / (totalDurationMs / 60_000))
      : 0;

  const dayMap = new Map<string, number>();
  for (const item of items) {
    const key = toDateKey(new Date(item.createdAt));
    dayMap.set(key, (dayMap.get(key) ?? 0) + item.wordCount);
  }

  const activeDateKeys = Array.from(dayMap.keys()).sort();
  const activeDays = activeDateKeys.length;

  // Streaks (DST-safe calendar day comparison)
  let longestStreak = 0;
  let running = 0;
  let prevDate: Date | null = null;
  for (const key of activeDateKeys) {
    const [y, m, d] = key.split('-').map(Number);
    const currDate = new Date(y, m - 1, d);
    if (prevDate !== null && toDateKey(addCalendarDays(prevDate, 1)) === key) {
      running += 1;
    } else {
      running = 1;
    }
    if (running > longestStreak) longestStreak = running;
    prevDate = currDate;
  }

  // Current streak (includes today or yesterday)
  let currentStreak = 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = toDateKey(today);
  const yesterday = addCalendarDays(today, -1);
  const yesterdayKey = toDateKey(yesterday);

  let cursor: Date | null = null;
  if (dayMap.has(todayKey)) {
    cursor = today;
  } else if (dayMap.has(yesterdayKey)) {
    cursor = yesterday;
  }
  while (cursor && dayMap.has(toDateKey(cursor))) {
    currentStreak += 1;
    cursor = addCalendarDays(cursor, -1);
  }

  const categories: PersonalizationCategory[] = [
    'AI assistants',
    'Messaging',
    'Social platforms',
    'Development tools',
  ];

  const categoryCounts: Record<PersonalizationCategory, number> = {
    'AI assistants': 0,
    Messaging: 0,
    'Social platforms': 0,
    'Development tools': 0,
  };

  for (const item of items) {
    const cat = item.category ?? classifyTranscriptCategory(item.text, item.mode);
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
  }

  const hasAnyActivity = items.length > 0 || dictionaryCount > 0;
  const categoryBreakdown = categories.map((cat) => {
    const count = categoryCounts[cat];
    const rawPct = hasAnyActivity
      ? Math.min(100, count * 2.5 + (count > 0 ? dictionaryCount * 0.8 : dictionaryCount * 0.25))
      : 0;
    return {
      category: cat,
      percent: Number(rawPct.toFixed(1)),
      count,
    };
  });

  const personalizationPercent = hasAnyActivity
    ? Number(
        (
          categoryBreakdown.reduce((sum, c) => sum + c.percent, 0) /
          categories.length
        ).toFixed(1)
      )
    : 0;

  const formatted = formatWordCount(totalWords);

  return {
    totalWords,
    formattedWords: `${formatted.value} ${formatted.unit}`,
    timeSavedMinutes,
    timeSavedSeconds,
    averageWpm,
    totalDictationMinutes,
    totalDictationSeconds,
    activeDays,
    currentStreak,
    longestStreak,
    personalizationPercent,
    categoryBreakdown,
  };
}

export function buildHeatmapWeeks(
  items: HistoryItem[],
  endDate: Date,
  weeksCount = 28
): HeatmapWeek[] {
  const dayStats = new Map<string, { words: number; sessions: number }>();
  let earliestTime: number | null = null;

  for (const item of items) {
    const d = new Date(item.createdAt);
    const key = toDateKey(d);
    const prev = dayStats.get(key) ?? { words: 0, sessions: 0 };
    dayStats.set(key, {
      words: prev.words + item.wordCount,
      sessions: prev.sessions + 1,
    });
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (earliestTime === null || dayStart < earliestTime) {
      earliestTime = dayStart;
    }
  }

  // Align end to Saturday of endDate's week using DST-safe calendar arithmetic
  const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const dayOfWeek = endDay.getDay(); // 0=Sun..6=Sat
  const saturday = addCalendarDays(endDay, 6 - dayOfWeek);
  const startSunday = addCalendarDays(saturday, -(weeksCount * 7 - 1));

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const fullMonths = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const weeks: HeatmapWeek[] = [];
  let lastMonth = -1;

  for (let w = 0; w < weeksCount; w++) {
    const days: HeatmapCell[] = [];
    let monthLabel: string | undefined;

    for (let d = 0; d < 7; d++) {
      const cellDate = addCalendarDays(startSunday, w * 7 + d);
      if (d === 0 && cellDate.getMonth() !== lastMonth) {
        monthLabel = monthNames[cellDate.getMonth()];
        lastMonth = cellDate.getMonth();
      }

      const key = toDateKey(cellDate);
      const stat = dayStats.get(key);
      const words = stat?.words ?? 0;
      const sessions = stat?.sessions ?? 0;

      let level: 0 | 1 | 2 | 3 | 4 = 0;
      if (words >= 350) level = 4;
      else if (words >= 150) level = 3;
      else if (words >= 50) level = 2;
      else if (words > 0) level = 1;

      const hatched =
        earliestTime !== null
          ? cellDate.getTime() < earliestTime
          : false;

      let usageLabel = 'No activity';
      if (level === 4) usageLabel = `Power usage · ${words} words`;
      else if (level === 3) usageLabel = `Heavy usage · ${words} words`;
      else if (level === 2) usageLabel = `Steady usage · ${words} words`;
      else if (level === 1) usageLabel = `Light usage · ${words} words`;

      days.push({
        dateKey: key,
        date: cellDate,
        words,
        sessions,
        level,
        hatched: hatched && words === 0,
        label: `${fullMonths[cellDate.getMonth()]} ${cellDate.getDate()}, ${cellDate.getFullYear()}`,
        usageLabel,
      });
    }

    weeks.push({ days, monthLabel });
  }

  return weeks;
}
