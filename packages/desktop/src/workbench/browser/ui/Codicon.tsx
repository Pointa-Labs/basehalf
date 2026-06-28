import type { CSSProperties, JSX } from 'react';

/**
 * A VS Code Codicon — renders one icon from the official `@vscode/codicons` font
 * (imported once in main.tsx). `name` is the codicon id without the prefix, e.g.
 * `add`, `git-commit`, `chevron-down`. This replaces the ad-hoc unicode/emoji
 * glyphs so the icon set is 1:1 with VS Code.
 *
 * Defaults to `currentColor` + 16px (the codicon design size); pass `size`/`color`
 * to override. Decorative by default (aria-hidden) — give a `title` for a tooltip.
 */
export const Codicon = ({
  name,
  size,
  color,
  title,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  title?: string;
  style?: CSSProperties;
}): JSX.Element => (
  <span
    className={`codicon codicon-${name}`}
    aria-hidden={title === undefined}
    {...(title !== undefined && { title, role: 'img', 'aria-label': title })}
    style={{
      fontSize: size ?? 16,
      // The codicon font sets line-height:1; keep the glyph square + centered.
      lineHeight: 1,
      ...(color !== undefined && { color }),
      ...style,
    }}
  />
);
