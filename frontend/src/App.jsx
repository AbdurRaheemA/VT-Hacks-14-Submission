import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BadgeCheck, Bell, BookOpen, Check, CheckCheck, ChevronRight, CreditCard, GraduationCap, Grid2X2, Heart, HelpCircle, Leaf, MapPin, Menu, MessageCircle, Plus, Search, Send, ShieldCheck, ShoppingBag, SlidersHorizontal, Sofa, Sparkles, Tag, Wallet, X, Headphones, Shirt, Lamp, Gift } from 'lucide-react';
import { initialListings } from './data';
import Marketplace, { SiteHeader, CategoryNav, SiteFooter } from './components/Marketplace';
import './dorm.css';
import './settings.css';
import './payments.css';
import CampusWallet, { AddCredits, PaymentSetup, PaymentCheckout } from './components/CampusWallet';
import ProfilePanel from './components/ProfilePanel';
import { figmaImage } from './figmaAssets';
import { depositTestCredits, getWallet } from './api';

function useStored(key, fallback, normalize = value => value) {
  const [value, setValue] = useState(() => { try { return normalize(JSON.parse(localStorage.getItem(key)) ?? fallback); } catch { return fallback; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep the session usable when browser storage is full or unavailable. */ } }, [key, value]);
  return [value, setValue];
}
const categories = [['All finds', Grid2X2], ['Textbooks', BookOpen], ['Furniture', Sofa], ['Electronics', Headphones], ['Dorm essentials', Lamp], ['Clothing & more', Shirt], ['Free Stuff', Gift]];
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);

export default function App() {
  const [theme, setTheme] = useStored('dormio-theme', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [profile, setProfile] = useStored('dormio-profile', { name: 'Alex W.', campus: 'Virginia Tech', year: 'Sophomore', bio: '', pickup: '', avatar: figmaImage('v13_27') }, value => ({ ...value, campus: 'Virginia Tech' }));
  const toggleTheme = () => setTheme(current => current === 'dark' ? 'light' : 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const [page, setPage] = useState('Explore');
  const [category, setCategory] = useState('All finds');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recommended');
  const [saved, setSaved] = useStored('dormio-v1-saved', []);
  const [listings, setListings] = useStored('dormio-v1-listings', initialListings, items => items.map(item => ({ ...item, campus: 'Virginia Tech' })));
  const [preferences, setPreferences] = useStored('dormio-payments', { preferred: 'wallet', handles: {} });
  const [checkoutMethod, setCheckoutMethod] = useState('wallet');
  const [setupMethod, setSetupMethod] = useState('stripe');
  const [transactions, setTransactions] = useStored('dormio-v1-transactions', []);
  const [walletAccount, setWalletAccount] = useState(null);
  const [walletConnectionError, setWalletConnectionError] = useState('');
  const [messages, setMessages] = useStored('dormio-v1-messages', []);
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState('');
  const [maxPrice, setMaxPrice] = useState(10000);
  const [condition, setCondition] = useState('Any condition');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [activeChat, setActiveChat] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [paymentDone, setPaymentDone] = useState(false);
  const [formError, setFormError] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const balance = (walletAccount?.balance ?? 500) - transactions.reduce((sum, tx) => sum + (tx.kind !== 'deposit' && (!tx.method || tx.method === 'wallet') && tx.status !== 'cancelled' ? tx.amount : 0), 0);
  const toastTimer = useRef();
  const showToast = text => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500); };
  useEffect(() => {
    let active = true;
    getWallet().then(({ account }) => {
      if (!active) return;
      setWalletAccount(account);
      setWalletConnectionError('');
    }).catch(() => {
      if (active) setWalletConnectionError('Nessie wallet is offline. Showing local demo funds.');
    });
    return () => { active = false; };
  }, []);
  const addTestCredits = async ({ amount, provider, checkoutId }) => {
    const result = await depositTestCredits({ amount, provider, checkoutId });
    setWalletAccount(result.account);
    setWalletConnectionError('');
    setTransactions(current => current.some(tx => tx.id === checkoutId) ? current : [{ id: checkoutId, kind: 'deposit', title: 'Wallet credit top-up', seller: 'Nessie test bank', amount, method: provider, status: 'completed', date: new Date().toISOString() }, ...current]);
    closeModal();
    showToast(`${money(amount)} in test credits added with ${provider}.`);
    return result;
  };
  const saveProfile = next => {
    next = { ...next, campus: 'Virginia Tech' };
    try { localStorage.setItem('dormio-profile', JSON.stringify(next)); }
    catch { throw new Error('Not enough browser storage. Try a smaller profile photo.'); }
    setProfile(next);
    setListings(current => current.map(item => item.own ? { ...item, campus: next.campus, initials: next.name.charAt(0), location: next.pickup || 'On campus' } : item));
    setModal(null); showToast('Profile updated.');
  };
  const navigate = next => { setPage(next); setMobileNav(false); setSearch(''); setCategory('All finds'); };
  const toggleSave = id => setSaved(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const openDetail = item => { setSelected(item); setPaymentDone(false); setFormError(''); setModal('detail'); };
  const openSell = () => { setImagePreview(''); setFormError(''); setModal('sell'); };
  const closeModal = () => { setModal(null); setFormError(''); };
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    const elements = () => [...dialog.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(el => !el.disabled);
    elements()[0]?.focus();
    const onKey = e => {
      if (e.key === 'Escape') setModal(null);
      if (e.key === 'Tab') { const focusable = elements(); const first = focusable[0]; const last = focusable.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; previous?.focus(); };
  }, [modal]);
  const startChat = item => { setActiveChat(item); setModal(null); navigate('Messages'); };
  const submitMessage = e => { e.preventDefault(); if (!messageText.trim() || !activeChat) return; setMessages(current => [...current, { id: Date.now(), listingId: activeChat.id, text: messageText.trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]); setMessageText(''); };
  const buyItem = () => {
    if (checkoutMethod === 'stripe') { setFormError('Stripe checkout requires a backend integration.'); return; }
    if (checkoutMethod === 'wallet' && selected.price > balance) { setFormError('Your demo wallet does not have enough funds for this purchase.'); return; }
    if (transactions.some(tx => tx.listingId === selected.id && tx.status !== 'cancelled')) return;
    setTransactions(current => [{ id: `LP-${Date.now().toString().slice(-7)}`, listingId: selected.id, title: selected.title, seller: selected.seller, amount: selected.price, method: checkoutMethod, status: checkoutMethod === 'wallet' ? 'completed' : 'pending', date: new Date().toISOString() }, ...current]);
    setListings(current => current.map(item => item.id === selected.id ? { ...item, sold: true } : item)); setPaymentDone(true);
  };
  const submitListing = e => {
    e.preventDefault(); const data = new FormData(e.currentTarget); const price = Number(data.get('price'));
    if (data.get('category') === 'Free Stuff' && price !== 0) { setFormError('Free Stuff listings must have a price of $0.'); return; }
    if (!imagePreview) { setFormError('Add a photo so other students can see your item.'); return; }
    if (!Number.isFinite(price) || price < 0 || price > 10000) { setFormError('Please enter a price between $0 and $10,000.'); return; }
    setListings(current => [{ id: Date.now(), title: data.get('title').trim(), price, category: price === 0 ? 'Free Stuff' : data.get('category'), condition: data.get('condition'), description: data.get('description').trim(), image: imagePreview, location: profile.pickup || 'On campus', campus: profile.campus, seller: 'You', initials: profile.name.charAt(0), color: '#eaded3', age: 0, own: true }, ...current]);
    closeModal(); navigate('My listings'); showToast('Your listing is live. Welcome to the loop!');
  };
  const uploadImage = e => { const file = e.target.files[0]; if (!file) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setFormError('Choose a JPG, PNG, or WebP image.'); return; } if (file.size > 2000000) { setFormError('Choose an image smaller than 2 MB.'); return; } const reader = new FileReader(); reader.onload = () => { setImagePreview(reader.result); setFormError(''); }; reader.readAsDataURL(file); };
  const filtered = listings.filter(item => !item.sold && (page !== 'Saved items' || saved.includes(item.id)) && (page !== 'My listings' || item.own) && (category === 'All finds' || (category === 'Free Stuff' ? item.price === 0 : item.category === category)) && `${item.title} ${item.category}`.toLowerCase().includes(search.toLowerCase()) && item.price <= maxPrice && (condition === 'Any condition' || item.condition === condition)).sort((a, b) => sort === 'low' ? a.price - b.price : sort === 'high' ? b.price - a.price : sort === 'new' ? a.age - b.age : sort === 'popular' ? (b.likes || 0) - (a.likes || 0) : 0);
  const nav = [['Explore', Grid2X2], ['Saved items', Heart], ['Messages', MessageCircle], ['My listings', Tag], ['My wallet', Wallet]];
  const chatItems = listings.filter(item => messages.some(m => m.listingId === item.id) || item.id === activeChat?.id);

  const onCategory = value => { navigate('Explore'); setCategory(value); };
  return <div className="dorm-app">
    <SiteHeader {...{ search, setSearch, page, navigate, openSell, setModal, profile, theme, toggleTheme }} savedCount={saved.length} />
    <CategoryNav {...{ category, onCategory }} />
    <main className={['Explore', 'Saved items', 'My listings'].includes(page) ? 'dorm-main' : 'dorm-main dorm-inner-page'}>
      {['Explore', 'Saved items', 'My listings'].includes(page) && <Marketplace {...{ page, category, search, filtered, saved, toggleSave, openDetail, openSell, setModal, sort, setSort, maxPrice, setMaxPrice, condition, setCondition, onCategory }} />}
        {page === 'My wallet' && <CampusWallet {...{ balance, profile, transactions, preferences, setPreferences, setModal, setSetupMethod, navigate, walletAccount, walletConnectionError }} cancelReservation={id => {
          const tx = transactions.find(item => item.id === id);
          if (!tx || tx.status !== 'pending') return;
          setTransactions(current => current.map(item => item.id === id ? { ...item, status: 'cancelled' } : item));
          setListings(current => current.map(item => item.id === tx.listingId ? { ...item, sold: false } : item));
          showToast('Reservation cancelled. No funds were charged.');
        }} contactSeller={id => { const item = listings.find(item => item.id === id); if (item) startChat(item); }} />}
        {page === 'Messages' && <><div className="page-heading"><div><div className="eyebrow"><span /> MAKE A CAMPUS CONNECTION</div><h1>A good find starts with hello.</h1><p>Ask a question, arrange a pickup, and keep the conversation going.</p></div></div><div className="messages-layout"><aside className="chat-list"><h3>Your conversations</h3>{chatItems.length ? chatItems.map(item => <button className={activeChat?.id === item.id ? 'active' : ''} onClick={() => setActiveChat(item)} key={item.id}><span className="avatar" style={{ background: item.color }}>{item.initials}</span><span><strong>{item.seller}</strong><small>{item.title}</small></span><ChevronRight size={15} /></button>) : <p>Message a seller from a listing to start a conversation.</p>}</aside><section className="chat-panel">{activeChat ? <><div className="chat-header"><img src={activeChat.image} alt="" /><div><strong>{activeChat.seller}</strong><small>{activeChat.title} · {money(activeChat.price)}</small></div><button className="text-button" onClick={() => openDetail(activeChat)}>View listing</button></div><div className="chat-messages"><div className="chat-demo"><ShieldCheck size={16} /> Demo conversation · Messages are saved on this device.</div>{messages.filter(m => m.listingId === activeChat.id).map(m => <div className="message-bubble" key={m.id}>{m.text}<small>{m.time}<CheckCheck size={13} /></small></div>)}{!messages.some(m => m.listingId === activeChat.id) && <div className="chat-starter"><MessageCircle size={32} /><p>Say hello to {activeChat.seller.split(' ')[0]}.</p><button onClick={() => setMessageText('Hi! Is this still available? I can pick it up on campus.')} className="category">Is this still available?</button></div>}</div><form onSubmit={submitMessage} className="message-form"><input aria-label="Your message" placeholder="Write a friendly hello..." value={messageText} onChange={e => setMessageText(e.target.value)} maxLength={2000} /><button className="primary" aria-label="Send message" disabled={!messageText.trim()}><Send size={18} /></button></form></> : <div className="empty-state"><MessageCircle size={40} /><h3>Your people are right around the corner.</h3><p>Choose a conversation, or find something you love.</p><button className="primary" onClick={() => navigate('Explore')}>Find something good <ArrowRight size={16} /></button></div>}</section></div></>}
    </main>
    <SiteFooter {...{ navigate, onCategory, setModal }} />
    {toast && <div className="toast" role="status"><Check size={18} />{toast}</div>}
    {modal && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}><section role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`modal ${modal === 'detail' ? 'detail-modal' : ''}`}><button className="modal-close icon-button" onClick={closeModal} aria-label="Close dialog"><X size={21} /></button>
      {modal === 'detail' && selected && <><div className="detail-image"><img src={selected.image} alt={selected.title} /></div><div className="detail-content"><div className="eyebrow">{selected.category} · {selected.condition}</div><h2 id="modal-title">{selected.title}</h2><div className="detail-price">{money(selected.price)} {selected.original && <del>{money(selected.original)}</del>}</div><p>{selected.description}</p><div className="detail-seller"><span className="avatar" style={{ background: selected.color }}>{selected.initials}</span><div><strong>{selected.seller} <BadgeCheck size={14} /></strong><small>Virginia Tech · {selected.location}</small></div></div><div className="pickup-note"><MapPin size={18} /><span>Meet nearby, keep it simple.<small>Arrange a public campus pickup with the seller.</small></span></div>{selected.sold || transactions.some(tx => tx.listingId === selected.id && tx.status !== 'cancelled') ? <div className="status-pill">This find has a new home.</div> : selected.own ? <button className="secondary full-width" onClick={() => { setListings(current => current.filter(item => item.id !== selected.id)); closeModal(); showToast('Listing removed.'); }}>Remove your listing</button> : <><button className="primary full-width" onClick={() => { setCheckoutMethod(preferences.preferred); setModal('checkout'); setPaymentDone(false); }}>Make it yours <ArrowRight size={17} /></button><button className="secondary full-width" onClick={() => startChat(selected)}><MessageCircle size={17} /> Message seller</button></>}<div className="checkout-note"><ShieldCheck size={13} /> Nessie-powered demo checkout</div></div></>}
      {modal === 'checkout' && <PaymentCheckout {...{ selected, balance, buyItem, paymentDone, startChat, closeModal, navigate }} method={checkoutMethod} setMethod={setCheckoutMethod} error={formError} />}
      {modal === 'addCredits' && <AddCredits onDeposit={addTestCredits} />}
      {modal === 'paymentSetup' && <PaymentSetup methodId={setupMethod} {...{ preferences, closeModal }} save={(method, handle) => { setPreferences(current => ({ ...current, handles: { ...current.handles, [method]: handle } })); closeModal(); showToast('Payment details saved.'); }} />}
      {modal === 'sell' && <form className="modal-body sell-form" onSubmit={submitListing}><div className="eyebrow">PASS IT ON. MAKE SOMEONE’S DAY.</div><h2 id="modal-title">Give it a second chapter.</h2><p>A few details, one photo, and you’re in the loop.</p><label className={`upload-area ${imagePreview ? 'has-image' : ''}`}>{imagePreview ? <img src={imagePreview} alt="Listing preview" /> : <><Plus size={28} /><strong>Add your best photo</strong><span>JPG, PNG, or WebP · Up to 2 MB</span></>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} aria-label="Upload listing photo" /></label><label>What are you selling?<input name="title" required maxLength={70} placeholder="e.g. Your next favorite desk chair" /></label><div className="form-grid"><label>Category<select name="category">{categories.slice(1).map(([name]) => <option key={name}>{name}</option>)}</select></label><label>Condition<select name="condition"><option>Like new</option><option>Good</option><option>Fair</option></select></label></div><label>Price ($)<input name="price" type="number" min="0" max="10000" step="0.01" placeholder="25.00" required /></label><label>A little about your item<textarea name="description" required maxLength={1200} rows={3} placeholder="The details you’d want to know. Condition, size, pickup spot..." /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<button className="primary full-width" type="submit">Publish listing <ArrowRight size={17} /></button><span className="checkout-note">Your listing is saved locally in this demo.</span></form>}
      {modal === 'help' && <div className="modal-body"><div className="eyebrow">GOOD NEIGHBORS. GOOD FINDS.</div><h2 id="modal-title">Welcome to the community.</h2><div className="help-item"><Search /><div><h3>Find your next favorite</h3><p>Browse by category, set a budget, or search for something specific. Save your favorites with the heart.</p></div></div><div className="help-item"><MessageCircle /><div><h3>Say hello, meet on campus</h3><p>Ask sellers about the item and agree on a public pickup spot, like the library or student center.</p></div></div><div className="help-item"><Wallet /><div><h3>Try your campus wallet</h3><p>Everyone starts with $500 in demo funds. Purchases update your balance and history on this device.</p></div></div><div className="help-item"><Leaf /><div><h3>Keep the good things going</h3><p>List items with honest descriptions and clear photos. A little care makes a better campus community.</p></div></div></div>}
      {modal === 'notifications' && <div className="modal-body"><div className="eyebrow">IN THE LOOP</div><h2 id="modal-title">Your campus updates.</h2><div className="help-item"><Sparkles /><div><h3>Welcome to Dorm.io!</h3><p>Your campus marketplace is ready to explore. Find your next favorite or give something a second home.</p></div></div><div className="help-item"><Wallet /><div><h3>Your demo wallet is ready</h3><p>You have {money(balance)} to explore the simulated checkout experience.</p><button className="text-button" onClick={() => { closeModal(); navigate('My wallet'); }}>Open your wallet <ArrowRight size={15} /></button></div></div></div>}
      {['shop', 'ecohub', 'app', 'about', 'privacy', 'terms'].includes(modal) && <div className="modal-body"><div className="eyebrow">DORM.IO COMMUNITY</div><h2 id="modal-title">{{ shop: 'Sofia’s Thrift Haven', ecohub: 'Hokie Sustainability Hub', app: 'Your campus, coming to your pocket.', about: 'Built around campus life.', privacy: 'Your demo data stays here.', terms: 'A little care goes a long way.' }[modal]}</h2><p>{{ shop: 'Sofia is a featured seller concept from the design. Her shop has no active listings yet. Explore the campus clothing collection in the meantime.', ecohub: 'This featured campus initiative celebrates reuse and semester-end donations. You can join the spirit of the project by listing an item for free.', app: 'The mobile apps shown in the design are coming soon. There is no App Store or Google Play release yet. You can use this responsive website on your phone today.', about: 'Dorm.io is a student marketplace prototype for finding good deals, sharing useful things, and making campus life a little more circular. Careers, brand assets, and support channels are not live yet.', privacy: 'This prototype stores listings, photos, favorites, messages, and demo purchases in your browser. No real student verification or payments take place. Clearing this site’s browser storage removes your demo data. Fonts load from Google Fonts; listing images are bundled locally.', terms: 'Use honest descriptions and clear photos. Arrange pickups in public campus spaces. This is a demo with simulated funds and sample seller profiles; the featured shops and organizations are design concepts.' }[modal]}</p>{modal === 'shop' && <button className="primary full-width" onClick={() => { closeModal(); onCategory('Clothing & more'); }}>Explore Clothing & Fits <ArrowRight size={17} /></button>}{modal === 'ecohub' && <button className="primary full-width" onClick={openSell}>Post an item for free <Gift size={17} /></button>}</div>}
      {modal === 'profile' && <ProfilePanel {...{ profile, theme, toggleTheme, navigate, closeModal }} onSave={saveProfile} counts={{ listings: listings.filter(item => item.own && !item.sold).length, saved: saved.length, orders: transactions.length }} />}
    </section></div>}
  </div>;
}
