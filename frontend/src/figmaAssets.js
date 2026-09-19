// Vite resolves and fingerprints every image from the original Figma export.
const files = import.meta.glob('../Figma HTML/images/*.png', { eager: true, query: '?url', import: 'default' });
export const figmaImage = name => files[`../Figma HTML/images/${name}.png`];
