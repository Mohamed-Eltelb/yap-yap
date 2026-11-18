import { describe, expect, it } from 'vitest';
import { answerAsPlainText } from '../utils/answerText';

describe('copying an Ask answer', () => {
  it('drops the Markdown symbols and keeps the words and lists', () => {
    const answer = [
      '## Bitcoin today',
      'Bitcoin is trading around **$64,400–$64,800 USD** (as of *Nov 18*). Major sources show:',
      '',
      '* CoinMarketCap: $64,359',
      '+ Crypto.com: `$64,754`',
      '1. See [Investing.com](https://investing.com)',
      '> Prices change by the minute.',
      '---',
    ].join('\n');

    expect(answerAsPlainText(answer)).toBe([
      'Bitcoin today',
      'Bitcoin is trading around $64,400–$64,800 USD (as of Nov 18). Major sources show:',
      '',
      '- CoinMarketCap: $64,359',
      '- Crypto.com: $64,754',
      '1. See Investing.com',
      'Prices change by the minute.',
    ].join('\n'));
  });

  it('leaves plain text, math, and names with underscores alone', () => {
    const plain = 'Use snake_case for my_var. 2 * 3 * 4 = 24.\n- one\n- two';
    expect(answerAsPlainText(plain)).toBe(plain);
  });

  it('removes code fences but keeps the code', () => {
    expect(answerAsPlainText('Run:\n```bash\nnpm test\n```')).toBe('Run:\nnpm test');
  });

  it('keeps Arabic text and its emphasis words', () => {
    expect(answerAsPlainText('السعر **٦٤ ألف دولار** تقريبًا')).toBe('السعر ٦٤ ألف دولار تقريبًا');
  });
});
