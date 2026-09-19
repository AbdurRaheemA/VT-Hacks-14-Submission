import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

test('marketplace browsing, saved items, messaging, checkout, and persistence', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Event', 'MouseEvent', 'FormData', 'FileReader']) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const server = await createServer({ server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  let root;
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.jsx');
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(createElement(App)));
    const click = async selector => {
      const element = document.querySelector(selector);
      assert.ok(element, `Expected element: ${selector}`);
      await act(async () => element.click());
    };
    const button = async label => {
      const element = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label);
      assert.ok(element, `Expected button: ${label}`);
      await act(async () => element.click());
    };
    const type = async (selector, value) => {
      const element = document.querySelector(selector);
      assert.ok(element);
      await act(async () => {
        const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
        element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    };
    assert.equal(document.querySelectorAll('.product-card').length, 8);
    await button('Textbooks');
    assert.equal(document.querySelectorAll('.product-card').length, 2);
    await button('All finds');
    await type('input[aria-label="Search marketplace"]', 'Sony');
    assert.equal(document.querySelectorAll('.product-card').length, 1);
    await click('[aria-label="Clear search"]');
    await click('[aria-label="Save The perfect study chair"]');
    assert.deepEqual(JSON.parse(localStorage.getItem('loop-saved')), [1]);
    await click('.nav-item:nth-child(2)');
    assert.equal(document.querySelectorAll('.product-card').length, 1);
    await click('[aria-label="View The perfect study chair"]');
    await button('Message seller');
    await button('Is this still available?');
    await click('[aria-label="Send message"]');
    assert.match(document.querySelector('.message-bubble').textContent, /Is this still available/);
    assert.equal(JSON.parse(localStorage.getItem('loop-messages')).length, 1);
    await button('View listing');
    await button('Make it yours');
    assert.match(document.querySelector('.payment-method').textContent, /\$500/);
    await button('Pay $45');
    assert.match(document.querySelector('[role="dialog"]').textContent, /Good find. It’s yours!/);
    const transactions = JSON.parse(localStorage.getItem('loop-transactions'));
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].amount, 45);
    await button('View wallet activity');
    assert.match(document.querySelector('.wallet-card').textContent, /\$455/);
    await button('Explore');
    assert.equal(document.querySelectorAll('.product-card').length, 7);
    assert.equal(document.querySelector('[aria-label="View The perfect study chair"]'), null);
    await act(async () => root.unmount());
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(createElement(App)));
    assert.equal(document.querySelectorAll('.product-card').length, 7, 'purchased listings stay removed after remount');
    await button('My wallet');
    assert.match(document.querySelector('.wallet-card').textContent, /\$455/, 'wallet balance persists');
    await button('Sell an item');
    await type('[name="title"]', 'Desk lamp for a new semester');
    await type('[name="price"]', '18.50');
    await type('[name="description"]', 'A gently used lamp, available for pickup at the library.');
    await button('Publish listing');
    assert.match(document.querySelector('[role="alert"]').textContent, /Add a photo/);
    const fileInput = document.querySelector('input[type="file"]');
    const file = new dom.window.File([new Uint8Array([137, 80, 78, 71])], 'lamp.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    await act(async () => {
      fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    assert.ok(document.querySelector('[alt="Listing preview"]'));
    await button('Publish listing');
    assert.equal(document.querySelectorAll('.product-card').length, 1);
    assert.match(document.querySelector('.product-card').textContent, /Desk lamp for a new semester/);
    assert.match(document.querySelector('.price-row').textContent, /\$18.5/);
    assert.ok(JSON.parse(localStorage.getItem('loop-listings')).some(item => item.own && item.price === 18.5));
    await click('[aria-label="View Desk lamp for a new semester"]');
    await button('Remove your listing');
    assert.equal(document.querySelectorAll('.product-card').length, 0);
  } finally {
    if (root) await act(async () => root.unmount());
    await server.close();
    dom.window.close();
  }
});
