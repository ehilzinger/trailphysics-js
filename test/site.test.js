import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as trailphysics from '../index.js';

// The playground (index.html, published to GitHub Pages) runs the package it
// sits in. These keep it honest about that: it imports this package and
// nothing else, loads nothing from another site, and calls only what the
// package exports, so a renamed function breaks this test rather than the
// page.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.slice(html.indexOf('<script type="module">'));

describe('the playground page', () => {
  it('imports this package and nothing else', () => {
    const loaded = [...script.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(loaded).toEqual(['./index.js']);
    // The code samples the page shows say `from 'trailphysics'`, as a
    // reader's own code would; nothing else may appear as a module source.
    const shown = new Set([...script.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]));
    expect([...shown]).toEqual(['trailphysics']);
  });

  it('loads no script, stylesheet, font or image from another site', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel="(stylesheet|preconnect|preload)"/i);
    expect(html).not.toMatch(/@import|url\(\s*['"]?https?:/i);
    expect(html).not.toMatch(/<img[^>]+src="https?:/i);
  });

  it('calls only functions the package exports', () => {
    const used = new Set([...script.matchAll(/\bTP\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(typeof trailphysics[name], name).toBe('function');
  });

  it('names its own address as the canonical one', () => {
    expect(html).toContain('<link rel="canonical" href="https://ehilzinger.github.io/trailphysics-js/">');
  });
});
