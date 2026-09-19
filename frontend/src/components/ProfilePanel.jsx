import { useState } from 'react';
import { Camera, Heart, Package, Wallet, Moon, Sun, Volume2 } from 'lucide-react';

const languages = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['zh-CN', 'Chinese (Simplified)'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['pt', 'Portuguese'], ['hi', 'Hindi'], ['ar', 'Arabic'],
];
const currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'KRW', 'MXN', 'BRL', 'CHF'];

export default function ProfilePanel({ profile, onSave, theme, toggleTheme, navigate, closeModal, counts, speechPreferences, setSpeechPreferences, speech }) {
  const [draft, setDraft] = useState(profile);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const update = event => setDraft(current => ({ ...current, [event.target.name]: event.target.value }));
  const photo = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1_000_000) { setError('Choose a JPG, PNG, or WebP photo under 1 MB.'); return; }
    setReading(true); setError('');
    const reader = new FileReader();
    reader.onload = () => { setDraft(current => ({ ...current, avatar: reader.result })); setReading(false); };
    reader.onerror = () => { setError('Could not read this photo. Try another image.'); setReading(false); };
    reader.readAsDataURL(file);
  };
  const submit = async event => {
    event.preventDefault();
    const next = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
    if (!next.name || !next.campus) { setError('Add your name and campus.'); return; }
    setSaving(true); setError('');
    try { await onSave(next); } catch (error) { setError(error.message); setSaving(false); }
  };
  const go = page => { closeModal(); navigate(page); };
  return <form className="modal-body account-panel" onSubmit={submit}>
    <h2 id="modal-title">Your profile</h2><p>Demo account access: save an existing name to open that person's profile and wallet. No password is required.</p>
    <div className="account-photo-row"><img src={draft.avatar} alt={`${draft.name || 'Your'} profile photo`} /><div><strong>{draft.name || 'Your name'}</strong><label className="change-photo"><Camera size={15} />{reading ? 'Loading photo…' : 'Change photo'}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Change profile photo" onChange={photo} disabled={reading} /></label><small>JPG, PNG, WebP · Under 1 MB</small></div></div>
    <div className="account-shortcuts"><button type="button" onClick={() => go('My listings')}><Package size={17} /><strong>{counts.listings}</strong>Listings</button><button type="button" onClick={() => go('Saved items')}><Heart size={17} /><strong>{counts.saved}</strong>Saved</button><button type="button" onClick={() => go('My wallet')}><Wallet size={17} /><strong>{counts.orders}</strong>Purchases</button></div>
    <div className="account-fields"><label>Display name<input name="name" value={draft.name} onChange={update} required maxLength={40} autoComplete="nickname" /></label><div className="account-field-grid"><label>Campus<input name="campus" value="Virginia Tech" readOnly aria-label="Campus" /></label><label>Year<select name="year" value={draft.year} onChange={update}><option>Freshman</option><option>Sophomore</option><option>Junior</option><option>Senior</option><option>Graduate</option><option>Other</option></select></label></div><div className="account-field-grid"><label>Chat language<select name="language" value={draft.language || 'en'} onChange={update}>{languages.map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select></label><label>Display currency<select name="currency" value={draft.currency || 'USD'} onChange={update}>{currencies.map(currency => <option key={currency}>{currency}</option>)}</select></label></div><label>Bio <span>Optional</span><textarea name="bio" value={draft.bio} onChange={update} rows={2} maxLength={160} placeholder="A little about you and what you sell" /></label><label>Preferred pickup spot<input name="pickup" value={draft.pickup} onChange={update} maxLength={80} placeholder="e.g. Newman Library" /></label></div>
    <div className="account-appearance"><span>{theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}Dark mode</span><button type="button" role="switch" aria-checked={theme === 'dark'} aria-label="Dark mode" className="theme-switch" onClick={toggleTheme}><span /></button></div>
    <fieldset className="account-accessibility"><legend><Volume2 size={18} /> Read aloud</legend><p>Point to an item or move keyboard focus to it to hear its accessible description.</p>
      <div className="accessibility-setting"><span><strong>Point to speak</strong><small>Enabled by default; you can turn it off at any time.</small></span><button type="button" role="switch" aria-checked={speechPreferences.enabled} aria-label="Point to speak" className="theme-switch" onClick={() => setSpeechPreferences(current => ({ ...current, enabled: !current.enabled }))}><span /></button></div>
      <label className="accessibility-setting"><span><strong>Speak keyboard focus</strong><small>Useful without a mouse; may duplicate a screen reader.</small></span><input type="checkbox" checked={speechPreferences.focusEnabled} disabled={!speechPreferences.enabled} onChange={event => setSpeechPreferences(current => ({ ...current, focusEnabled: event.target.checked }))} /></label>
      <div className="accessibility-options"><label>Reading speed<select value={speechPreferences.rate} disabled={!speechPreferences.enabled} onChange={event => setSpeechPreferences(current => ({ ...current, rate: Number(event.target.value) }))}><option value="0.8">Slower</option><option value="1">Normal</option><option value="1.2">Faster</option></select></label><label>Voice<select value={speechPreferences.voiceURI} disabled={!speechPreferences.enabled || !speech.supported} onChange={event => setSpeechPreferences(current => ({ ...current, voiceURI: event.target.value }))}><option value="">Device default</option>{speech.voices.filter(voice => voice.lang.toLowerCase().startsWith('en')).map(voice => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}</select></label></div>
      <div className="accessibility-actions"><button className="text-button" type="button" disabled={!speechPreferences.enabled || !speech.supported} onClick={speech.testSpeech}>Test voice</button><button className="text-button" type="button" disabled={!speech.supported} onClick={speech.stop}>Stop speaking</button></div>{!speech.supported && <small className="speech-unavailable">Read aloud is not supported by this browser.</small>}
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="account-save-row"><button className="secondary" type="button" onClick={closeModal}>Cancel</button><button className="primary" type="submit" disabled={reading || saving}>{saving ? 'Saving…' : 'Save changes'}</button></div><small className="account-local-note">Profile linked to your Nessie customer · Photo saved on this device</small>
  </form>;
}

export function NessieCustomerChooser({ name, candidates, onSelect, loading, error }) {
  return <div className="modal-body account-panel"><h2 id="modal-title">Choose your Nessie account</h2><p>More than one Nessie customer is named {name}. Choose the wallet that belongs to this demo profile.</p><div className="nessie-candidates">{candidates.map(candidate => { const account = candidate.accounts.find(item => item.type?.toLowerCase() === 'checking') || candidate.accounts[0]; return <button className="nessie-candidate" type="button" onClick={() => onSelect(candidate.customerId)} disabled={loading} key={candidate.customerId}><span><strong>{candidate.name}</strong><small>{account ? `${account.nickname || account.type} · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(account.balance)}` : 'A checking account will be created'}</small></span><code>…{candidate.customerId.slice(-8)}</code></button>; })}</div>{error && <p className="form-error" role="alert">{error}</p>}<small className="account-local-note">The Nessie customer ID is used only to resolve duplicate demo names.</small></div>;
}
