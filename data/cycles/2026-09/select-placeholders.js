// Frozen placeholder-selection algorithm for the commit-reveal scheme.
//
// PLAIN JAVASCRIPT ON PURPOSE. This exact file ships in the public cycle bundle
// and the runner imports it, so there is a single implementation. If the runner
// used a TypeScript copy and we published a separate JS one, the two could
// drift and the published algorithm would stop being the one that ran.
//
// Depends only on node:crypto so an auditor can run it with no install:
//
//   node -e "import('./select-placeholders.js').then(m => console.log(
//     m.selectPlaceholders(nonce, templates, banks, 33)))"
//
// Determinism contract: given the same (nonce, templates, banks, count) this
// returns byte-identical output on any machine and any Node version. Nothing
// here may use Math.random, Date, object key order or locale-sensitive
// comparison.

import { createHash } from "node:crypto";

/**
 * Deterministic 32-bit value from (nonce, label, counter).
 * Domain-separated by label so two placeholders never share a draw sequence.
 */
function u32(nonce, label, counter) {
  const digest = createHash("sha256").update(`${nonce}:${label}:${counter}`).digest("hex");
  return parseInt(digest.slice(0, 8), 16);
}

/**
 * Fisher-Yates shuffle driven entirely by the nonce.
 *
 * Shuffling the whole bank up front, then drawing successive entries, is what
 * keeps values from repeating: a template used three times in a cycle gets
 * three different values rather than three independent draws that might collide.
 */
function shuffleBank(nonce, label, bank) {
  const out = bank.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = u32(nonce, label, i) % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Resolve `count` prompts from the templates and value banks.
 *
 * Templates are assigned round-robin — even coverage across categories is a
 * property we want fixed, not randomised. The nonce decides only WHICH bank
 * value each slot receives, which is the part that could otherwise be steered
 * toward prompts a tool handles well.
 *
 * @param {string} nonce hex-encoded 32-byte nonce, revealed at cycle close
 * @param {{slug: string, category: string, prompt_text: string}[]} templates
 * @param {Record<string, string[]>} banks
 * @param {number} count
 */
export function selectPlaceholders(nonce, templates, banks, count) {
  if (!nonce) throw new Error("selectPlaceholders: nonce is required");
  if (!templates || templates.length === 0) throw new Error("selectPlaceholders: no templates");

  const shuffles = Object.create(null);
  const drawn = Object.create(null);
  const selected = [];

  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length];
    const match = template.prompt_text.match(/\[([A-Z]+)\]/);
    const placeholder = match ? match[1] : "";
    let value = "";

    if (placeholder) {
      if (!shuffles[placeholder]) {
        shuffles[placeholder] = shuffleBank(nonce, placeholder, banks[placeholder] || []);
        drawn[placeholder] = 0;
      }
      const bank = shuffles[placeholder];
      if (bank.length === 0) throw new Error(`selectPlaceholders: empty bank for ${placeholder}`);
      value = bank[drawn[placeholder] % bank.length];
      drawn[placeholder] += 1;
    }

    selected.push({
      index: i,
      templateSlug: template.slug,
      category: template.category,
      placeholder,
      value,
      prompt: match ? template.prompt_text.replace(match[0], value) : template.prompt_text,
    });
  }

  return selected;
}

/** sha256 of the nonce — this is what gets published at cycle open. */
export function commitHash(nonce) {
  return createHash("sha256").update(nonce).digest("hex");
}
