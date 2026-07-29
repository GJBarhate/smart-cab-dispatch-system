// The details that make a reveal toggle correct rather than merely present:
// it must not submit the form it sits in, it must carry an accessible label
// that states what it will do, and it must start hidden.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PasswordInput } from './PasswordInput';
const html = () => renderToString(<PasswordInput id="password" autoComplete="current-password" />);
describe('PasswordInput', () => {
  it('starts masked', () => {
    expect(html()).toContain('type="password"');
    expect(html()).not.toContain('type="text"');
  });
  it('renders a toggle that cannot submit the surrounding form', () => {
    // A bare <button> inside a <form> defaults to type="submit", so revealing
    // the password would try to sign in with a half-typed one.
    expect(html()).toContain('type="button"');
  });
  it('labels the toggle with the action it performs', () => {
    const out = html();
    expect(out).toContain('aria-label="Show password"');
    expect(out).toContain('aria-pressed="false"');
  });
  it('keeps the autocomplete hint so password managers still fill it', () => {
    // Matched case-insensitively: React emits the attribute with its camelCase
    // spelling, and HTML attribute names are case-insensitive, so the browser
    // and any password manager read it as `autocomplete` either way. Asserting
    // the exact casing would be testing a React rendering detail, not behaviour.
    expect(html()).toMatch(/autocomplete="current-password"/i);
  });
  it('leaves room for the toggle so the value cannot run underneath it', () => {
    expect(html()).toContain('pr-10');
  });
  it('does not show the Caps Lock warning before any typing', () => {
    expect(html()).not.toContain('Caps Lock is on');
  });
  it('forwards arbitrary input props through to the field', () => {
    const out = renderToString(<PasswordInput id="password" required placeholder="••••••••" />);
    expect(out).toContain('required');
    expect(out).toContain('placeholder="••••••••"');
  });
});
