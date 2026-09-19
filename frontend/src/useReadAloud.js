import { useCallback, useEffect, useRef, useState } from 'react';

const SPEAKABLE_SELECTOR = '[data-speech], button, a[href], input, select, textarea, img, [role="button"], [role="switch"], h1, h2, h3, p';
const EMOJI_SPEECH = [
  ['⚡️', 'lightning bolt emoji. '], ['⚡', 'lightning bolt emoji. '], ['📚', 'books emoji. '],
  ['💻', 'laptop emoji. '], ['🛋️', 'sofa emoji. '], ['🛋', 'sofa emoji. '], ['🧥', 'coat emoji. '],
  ['🍿', 'popcorn emoji. '], ['🎁', 'wrapped gift emoji. '], ['🎒', 'backpack emoji. '],
  ['💜', 'purple heart emoji. '], ['🔥', 'fire emoji. '], ['✨', 'sparkles emoji. '],
  ['🤝', 'handshake emoji. '], ['💡', 'light bulb emoji. '], ['🎓', 'graduation cap emoji. '],
];
const clean = value => {
  let text = String(value || '');
  for (const [emoji, spoken] of EMOJI_SPEECH) text = text.replaceAll(emoji, spoken);
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
};

function controlLabel(element) {
  const explicit = element.getAttribute('aria-label');
  if (explicit) return clean(explicit);
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent).filter(Boolean).join(' ');
    if (text) return clean(text);
  }
  return clean(element.labels?.[0]?.textContent || element.getAttribute('placeholder') || element.textContent);
}

export function speechTextFor(element) {
  if (!element || element.closest('[data-speech-ignore]')) return '';
  const custom = element.getAttribute('data-speech');
  if (custom) return clean(custom);
  const tag = element.tagName.toLowerCase();
  if (tag === 'img') {
    const description = clean(element.getAttribute('alt'));
    return description ? `Image. ${description}.` : '';
  }
  const label = controlLabel(element);
  if (!label) return '';
  if (tag === 'select') {
    const choice = clean(element.selectedOptions?.[0]?.textContent);
    return `${label}. ${choice ? `Selected: ${choice}. ` : ''}Selection menu.`;
  }
  if (tag === 'textarea') return `${label}. Text area.`;
  if (tag === 'input') {
    const type = element.type || 'text';
    if (type === 'file') return `${label}. File picker.`;
    if (['checkbox', 'radio'].includes(type)) return `${label}. ${element.checked ? 'Selected' : 'Not selected'}.`;
    return `${label}. ${type === 'number' ? 'Number' : 'Text'} field.`;
  }
  if (tag === 'button' || element.getAttribute('role') === 'button' || element.getAttribute('role') === 'switch') {
    const state = element.getAttribute('aria-pressed') ?? element.getAttribute('aria-checked');
    return `${label}. ${state === null ? '' : state === 'true' ? 'On. ' : 'Off. '}Button.`;
  }
  if (/^h[1-3]$/.test(tag)) return `${label}. Heading.`;
  return label;
}

export default function useReadAloud({ enabled, focusEnabled, rate, voiceURI }) {
  const [voices, setVoices] = useState([]);
  const timer = useRef(null);
  const active = useRef({ element: null, source: null });
  const unlocked = useRef(false);
  const lastSpoken = useRef({ element: null, at: 0 });
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    active.current.element?.classList.remove('speech-active');
    active.current = { element: null, source: null };
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  const speak = useCallback((text, element = null, source = 'manual', delay = 0) => {
    if (!enabled || !supported || !text) return;
    stop();
    active.current = { element, source };
    timer.current = setTimeout(() => {
      const utterance = new window.SpeechSynthesisUtterance(clean(text));
      const selectedVoice = voices.find(voice => voice.voiceURI === voiceURI);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = Number(rate) || 1;
      utterance.lang = selectedVoice?.lang || document.documentElement.lang || 'en-US';
      element?.classList.add('speech-active');
      const finish = () => {
        element?.classList.remove('speech-active');
        if (active.current.element === element) active.current = { element: null, source: null };
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    }, delay);
  }, [enabled, rate, stop, supported, voiceURI, voices]);

  const testSpeech = useCallback(() => {
    unlocked.current = true;
    speak('Read aloud is ready. Point to an item or move keyboard focus to hear it.', null, 'manual');
  }, [speak]);

  useEffect(() => {
    if (!supported) return undefined;
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices());
    updateVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', updateVoices);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', updateVoices);
  }, [supported]);

  useEffect(() => {
    if (!enabled || !supported) {
      stop();
      return undefined;
    }
    const unlock = () => { unlocked.current = true; };
    const targetFor = node => node instanceof window.Element && !node.closest('[data-speech-ignore]') ? node.closest(SPEAKABLE_SELECTOR) : null;
    const schedule = (element, source, delay) => {
      if (!unlocked.current || !element || element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return;
      const text = speechTextFor(element);
      if (!text) return;
      const now = Date.now();
      if (lastSpoken.current.element === element && now - lastSpoken.current.at < 900) return;
      lastSpoken.current = { element, at: now };
      speak(text, element, source, delay);
    };
    const onPointerOver = event => {
      if (event.pointerType === 'touch') return;
      const next = targetFor(event.target);
      if (next && next !== targetFor(event.relatedTarget)) schedule(next, 'pointer', 600);
    };
    const onPointerOut = event => {
      if (active.current.source !== 'pointer') return;
      const current = targetFor(event.target);
      if (current && current !== targetFor(event.relatedTarget)) stop();
    };
    const onFocusIn = event => { if (focusEnabled) schedule(targetFor(event.target), 'focus', 80); };
    const onFocusOut = event => {
      if (active.current.source === 'focus' && targetFor(event.target) !== targetFor(event.relatedTarget)) stop();
    };
    const onKeyDown = event => {
      unlock();
      if (event.key === 'Escape') stop();
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      stop();
    };
  }, [enabled, focusEnabled, speak, stop, supported]);

  return { supported, voices, stop, testSpeech };
}
