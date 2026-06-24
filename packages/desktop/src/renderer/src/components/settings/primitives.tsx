/**
 * Shared settings-row primitives. Lifted out of Settings.tsx so both the
 * hand-laid app-shell rows (zoom, auto-update, About) and the registry-driven
 * rows (RegistrySettings) render through the SAME row/control language — a new
 * setting looks identical to an old one with no per-row styling.
 */

import type { CSSProperties, JSX, ReactNode } from 'react';
import { color, font, radius, space, transition } from '../../design.js';

/** Uppercase tracked-caps label above a group of setting rows. */
export const sectionLabelStyle: CSSProperties = {
  fontSize: font.size.micro,
  fontWeight: font.weight.medium,
  letterSpacing: font.trackedCaps,
  textTransform: 'uppercase',
  color: color.textTertiary,
  marginTop: space[5],
  marginBottom: space[1],
};

/** One setting: label + explanation on the left, its control on the right.
 *  Every section row goes through here so the grid stays aligned as rows
 *  accumulate. */
export const SettingRow = ({
  label,
  description,
  descriptionColor,
  control,
  inset,
}: {
  label: string;
  description?: string;
  /** Override for state-carrying descriptions (e.g. errors in danger red). */
  descriptionColor?: string;
  control: ReactNode;
  /** Render as a child refinement of the row above — indented with a left rail
   *  (e.g. a per-workspace override nested under its global default). */
  inset?: boolean;
}): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: space[4],
      padding: `${space[3]}px 0`,
      borderBottom: `1px solid ${color.divider}`,
      ...(inset && {
        marginLeft: space[4],
        paddingLeft: space[4],
        borderLeft: `2px solid ${color.border}`,
      }),
    }}
  >
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: font.size.body, color: color.textPrimary }}>{label}</div>
      {description && (
        <div
          style={{
            fontSize: font.size.caption,
            color: descriptionColor ?? color.textTertiary,
            marginTop: space[0.5],
            lineHeight: 1.45,
          }}
        >
          {description}
        </div>
      )}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: space[1.5], flexShrink: 0 }}>
      {control}
    </div>
  </div>
);

/** A pill on/off switch. */
export const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}): JSX.Element => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    style={{
      width: 36,
      height: 20,
      borderRadius: radius.pill,
      border: `1px solid ${checked ? color.accent : color.borderStrong}`,
      background: checked ? color.accent : color.surfaceMuted,
      position: 'relative',
      cursor: 'pointer',
      padding: 0,
      outline: 'none',
      flexShrink: 0,
      transition: transition(['background', 'border-color']),
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: 2,
        left: checked ? 18 : 2,
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: color.onAccent,
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transition: transition(['left']),
      }}
    />
  </button>
);

/** A small segmented (single-choice) control — e.g. the per-workspace override's
 *  tri-state (follow default / on / off). */
export const Segmented = ({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): JSX.Element => (
  <div
    style={{
      display: 'inline-flex',
      border: `1px solid ${color.borderStrong}`,
      borderRadius: radius.md,
      overflow: 'hidden',
    }}
  >
    {options.map((o, i) => {
      const selected = o.value === value;
      return (
        <button
          key={o.value}
          type="button"
          aria-pressed={selected}
          onClick={() => onChange(o.value)}
          style={{
            border: 'none',
            borderLeft: i === 0 ? 'none' : `1px solid ${color.borderStrong}`,
            background: selected ? color.accent : color.surfaceMuted,
            color: selected ? color.onAccent : color.textSecondary,
            cursor: 'pointer',
            padding: `4px ${space[2]}px`,
            fontFamily: font.sans,
            fontSize: font.size.ui,
          }}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);
