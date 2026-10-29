// Snippets injected into the page. Elements get a stable data-mcp-ref
// attribute so later click/type calls can find them again.

const HELPERS = `
  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=option],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  window.__mcpRefSeq = window.__mcpRefSeq || 0;
  function refOf(el) {
    if (!el.dataset.mcpRef) el.dataset.mcpRef = 'ref_' + (++window.__mcpRefSeq);
    return el.dataset.mcpRef;
  }
  function visible(el) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return t;
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return tag;
  }
  function nameOf(el) {
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder');
    if (label) return label.trim();
    if (el.labels && el.labels[0]) return el.labels[0].innerText.trim();
    return (el.innerText || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  }
  function describe(el) {
    const parts = [roleOf(el)];
    const name = nameOf(el);
    if (name) parts.push(JSON.stringify(name));
    if (el.tagName === 'A' && el.href) parts.push('href=' + el.getAttribute('href'));
    if ('value' in el && el.value && roleOf(el) !== 'button') parts.push('value=' + JSON.stringify(String(el.value).slice(0, 80)));
    if (el.checked) parts.push('checked');
    if (el.disabled) parts.push('disabled');
    return '[' + refOf(el) + '] ' + parts.join(' ');
  }
  function byRef(ref) {
    const el = document.querySelector('[data-mcp-ref="' + ref + '"]');
    if (!el) throw new Error('No element ' + ref + ' on the page (it may have changed; call read_page again)');
    return el;
  }
  function target(ref, selector) {
    if (ref) return byRef(ref);
    const el = document.querySelector(selector);
    if (!el) throw new Error('No element matches ' + selector);
    return el;
  }
`;

export function readPage(filter, maxChars) {
  return `${HELPERS}
    const out = ['Page: ' + document.title + ' — ' + location.href];
    if (${JSON.stringify(filter)} === 'interactive') {
      for (const el of document.querySelectorAll(INTERACTIVE)) if (visible(el)) out.push(describe(el));
    } else {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      const keep = new Set(['H1','H2','H3','H4','H5','H6','P','LI','IMG','LABEL','TD','TH']);
      let el;
      while ((el = walker.nextNode())) {
        if (!visible(el)) continue;
        if (el.matches(INTERACTIVE)) { out.push(describe(el)); continue; }
        if (keep.has(el.tagName)) {
          const text = el.tagName === 'IMG' ? (el.alt || '') : [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\\s+/g, ' ').trim();
          if (text) out.push(roleOf(el) + ': ' + text.slice(0, 300));
        }
      }
    }
    let s = out.join('\\n');
    if (s.length > ${maxChars}) s = s.slice(0, ${maxChars}) + '\\n…(truncated)';
    return s;
  `;
}

export function find(query) {
  return `${HELPERS}
    const q = ${JSON.stringify(query.toLowerCase())};
    const hits = [];
    for (const el of document.querySelectorAll(INTERACTIVE + ',h1,h2,h3,h4,label,p,li,img')) {
      if (!visible(el)) continue;
      const line = describe(el);
      if (line.toLowerCase().includes(q)) hits.push(line);
      if (hits.length >= 20) break;
    }
    return hits.length ? hits.join('\\n') : 'No matches for ' + JSON.stringify(q);
  `;
}

export function pageText(maxChars) {
  return `
    const root = document.querySelector('main, article, [role=main]') || document.body;
    const t = (root.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    return t.length > ${maxChars} ? t.slice(0, ${maxChars}) + '\\n…(truncated)' : t;
  `;
}

export function click(ref, selector) {
  return `${HELPERS}
    const el = target(${JSON.stringify(ref)}, ${JSON.stringify(selector)});
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    if (el.focus) el.focus();
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
    return 'Clicked ' + describe(el);
  `;
}

export function setValue(ref, selector, value, submit) {
  return `${HELPERS}
    const el = target(${JSON.stringify(ref)}, ${JSON.stringify(selector)});
    const value = ${JSON.stringify(value)};
    el.scrollIntoView({ block: 'center' });
    el.focus();
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      const want = value === true || value === 'true';
      if (el.checked !== want) el.click();
    } else {
      // Use the native setter so React and friends notice the change.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      if (el.tagName === 'SELECT') {
        const opt = [...el.options].find(o => o.value === value || o.text.trim() === value);
        if (!opt) throw new Error('No option ' + JSON.stringify(value));
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, opt.value);
      } else {
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (${submit ? "true" : "false"}) {
      const form = el.form || el.closest('form');
      if (form) { form.requestSubmit ? form.requestSubmit() : form.submit(); }
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
    return 'Set ' + describe(el);
  `;
}

export function scroll(direction, amount, ref) {
  return `${HELPERS}
    if (${JSON.stringify(ref)}) { byRef(${JSON.stringify(ref)}).scrollIntoView({ block: 'center' }); return 'Scrolled to ' + ${JSON.stringify(ref)}; }
    const px = ${amount} * 100;
    const d = ${JSON.stringify(direction)};
    window.scrollBy({ left: d === 'left' ? -px : d === 'right' ? px : 0, top: d === 'up' ? -px : d === 'down' ? px : 0 });
    return 'Scrolled to x=' + Math.round(scrollX) + ' y=' + Math.round(scrollY);
  `;
}
