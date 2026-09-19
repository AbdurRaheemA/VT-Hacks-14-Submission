// Keep the legacy Figma keys at call sites while serving source-controlled local photos.
// Vite resolves and fingerprints each image during the production build.
const files = import.meta.glob('./assets/images/*.{jpg,jpeg}', { eager: true, query: '?url', import: 'default' });

const imageNames = {
  v13_27: 'profile-avatar.jpg',
  v13_59: 'hero-dorm.jpg',
  v13_99: 'listing-mini-fridge.jpeg',
  v13_121: 'listing-laptop.jpg',
  v13_143: 'listing-bomber-jacket.jpg',
  v13_165: 'listing-chemistry-textbook.jpeg',
  v13_188: 'listing-office-chair.jpg',
  v13_210: 'listing-multicooker.jpg',
  v13_232: 'listing-speaker.jpg',
  v13_254: 'listing-rug.jpg',
  v13_288: 'listing-headphones.jpg',
  v13_311: 'listing-desk-lamp.jpg',
  v13_334: 'listing-shoe-rack.jpeg',
  v13_357: 'listing-crewneck.jpeg',
  v13_380: 'listing-dumbells.jpeg',
  v13_414: 'seller-sofia.jpg',
  v13_454: 'app-promo-phone.jpg',
};

export const figmaImage = name => files[`./assets/images/${imageNames[name]}`];
