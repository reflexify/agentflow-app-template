// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('gives the elements the font the page uses', () => {
  const style = document.createElement('style');
  style.textContent = readFileSync(join(import.meta.dirname, '../src/styles.css'), 'utf8');
  document.head.append(style);
  const rules = [...style.sheet!.cssRules] as CSSStyleRule[];
  const declared = (selector: string, property: string) => rules.find((r) => r.selectorText === selector)?.style.getPropertyValue(property);
  // `inherit` on a custom property inherits the same, unset, custom property, so it never reaches the page's font.
  expect(declared('agentflow-provider', '--agentflow-font')).toBe(declared(':root', 'font-family'));
});
