import { CategoryIcon } from './CategoryIcon';
import { SelectMenu } from './SelectMenu';
import { SettingsSubdialog } from './SettingsSubdialog';
import { mergeStyleCorrections, presetOf, STYLE_PRESETS, WRITING_CATEGORIES } from '../services/personalization';
import type { StyleCorrections } from '../types/app';

const LEARN = 'learn';
const CUSTOM = 'custom';

/**
 * How Yap Yap writes in each kind of place from the first dictation. A pick is saved as the
 * user's style for that place, so it applies right away, and learning only ever suggests changes.
 */
export function StartingStylesDialog({ corrections, defaultStyle, active, onChange, onDefaultChange, onClose }: {
  corrections: StyleCorrections;
  /** A preset id for places with no style picked or learned, or '' to learn only. */
  defaultStyle: string;
  onDefaultChange: (presetId: string) => void;
  /** Styles apply only with personalization and AI cleanup on. */
  active: boolean;
  onChange: (corrections: StyleCorrections) => void;
  onClose: () => void;
}) {
  const choose = (category: string, value: string) => {
    if (value === CUSTOM) return;
    if (value === LEARN) {
      const { [category]: _removed, ...rest } = corrections;
      onChange(rest);
      return;
    }
    const preset = STYLE_PRESETS.find((item) => item.id === value);
    if (!preset) return;
    onChange(mergeStyleCorrections(corrections, { [category]: { tone: preset.tone, phrasing: preset.phrasing } }, new Date().toISOString()));
  };

  return (
    <SettingsSubdialog
      wide
      title="Writing style"
      description="Pick how Yap Yap writes in each kind of place, starting with your next dictation. A style you pick stays until you change it; Yap Yap suggests an update in Writing preferences if your writing changes. “Learn from me” picks up your style as you dictate."
      onClose={onClose}
    >
      <div className="yy-language-body yy-variant-body yy-source-body">
        {!active && (
          <p className="yy-pref-note">Styles apply when personalization and AI cleanup are on.</p>
        )}
        <section className="yy-style-section" aria-labelledby="yy-style-default-heading">
          <h3 id="yy-style-default-heading">Default style</h3>
          <p>Used wherever you haven’t picked a style below and Yap Yap hasn’t learned one yet, including apps it doesn’t recognize.</p>
          <div className="yy-style-choices" role="radiogroup" aria-labelledby="yy-style-default-heading">
            {[{ id: LEARN, label: 'Learn from me', example: 'Picks up how you write' }, ...STYLE_PRESETS].map((item) => {
              const checked = (item.id === LEARN ? '' : item.id) === (STYLE_PRESETS.some((preset) => preset.id === defaultStyle) ? defaultStyle : '');
              return (
                <label key={item.id} className="yy-style-choice" data-checked={checked || undefined}>
                  <input
                    type="radio"
                    name="yy-default-style"
                    className="sr-only"
                    checked={checked}
                    onChange={() => onDefaultChange(item.id === LEARN ? '' : item.id)}
                  />
                  <strong>{item.label}</strong>
                  <span>{item.example}</span>
                </label>
              );
            })}
          </div>
        </section>
        <h3 className="yy-style-heading">By kind of place</h3>
        {WRITING_CATEGORIES.map((category) => {
          const correction = corrections[category];
          const preset = presetOf(correction);
          const custom = !preset && Boolean(correction?.tone || correction?.phrasing);
          const value = preset ?? (custom ? CUSTOM : LEARN);
          const options = [
            { value: LEARN, label: 'Learn from me' },
            ...STYLE_PRESETS.map((item) => ({ value: item.id, label: item.label })),
            ...(custom ? [{ value: CUSTOM, label: 'Your own style' }] : []),
          ];
          const detail = preset
            ? `“${STYLE_PRESETS.find((item) => item.id === preset)!.example}”`
            : custom
              ? 'Set in Writing preferences'
              : 'Learned as you dictate';
          return (
            <div className="yy-variant-row yy-source-row" key={category}>
              <span className="yy-source-icon"><CategoryIcon category={category} /></span>
              <span className="yy-source-name">
                <span>{category}</span>
                <small>{detail}</small>
              </span>
              <SelectMenu
                quiet
                label={`Writing style for ${category}`}
                value={value}
                options={options}
                onChange={(next) => choose(category, next)}
              />
            </div>
          );
        })}
      </div>
    </SettingsSubdialog>
  );
}
