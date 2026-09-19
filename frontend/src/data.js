import { figmaImage } from './figmaAssets';

const products = [
  [1, 'Mini Fridge (Super Clean, Works Perfect)', 45, 'Dorm essentials', 'Marcus Lopez', 'Virginia Tech', 42, 'v13_99'],
  [2, 'M1 MacBook Air 8GB/256GB Space Gray', 480, 'Electronics', 'Emma Stone', 'Virginia Tech', 128, 'v13_121'],
  [3, 'Vintage Leather Bomber Jacket (Oversized)', 65, 'Clothing & more', 'Tristan K.', 'Virginia Tech', 95, 'v13_143'],
  [4, 'Organic Chemistry Textbook 8th Ed.', 30, 'Textbooks', 'Aria Chen', 'Virginia Tech', 12, 'v13_165'],
  [5, 'Ergonomic Mesh Office Chair (Grey)', 80, 'Furniture', 'Devon R.', 'Virginia Tech', 34, 'v13_188'],
  [6, 'Instant Pot Duo 7-in-1 Multicooker', 25, 'Dorm essentials', 'Sarah Miller', 'Virginia Tech', 18, 'v13_210'],
  [7, 'JBL Flip 6 Waterproof Speaker', 55, 'Electronics', 'Lucas Thorne', 'Virginia Tech', 61, 'v13_232'],
  [8, 'Abstract Rug (Fits Dorm Rooms)', 35, 'Furniture', 'Clara B.', 'Virginia Tech', 50, 'v13_254'],
  [9, 'Sony WH-1000XM4 Noise Canceling', 150, 'Electronics', 'Jake Tyler', 'Virginia Tech', 9, 'v13_288'],
  [10, 'Desk Lamp with Wireless Charger Dock', 15, 'Dorm essentials', 'Lina Ross', 'Virginia Tech', 3, 'v13_311'],
  [11, 'Wooden Shoe Rack (3-Tier)', 12, 'Furniture', 'Ethan Wright', 'Virginia Tech', 7, 'v13_334'],
  [12, 'Vintage Champion Crewneck', 22, 'Clothing & more', 'Tristan K.', 'Virginia Tech', 14, 'v13_357'],
  [13, 'Adjustable Dumbbells Set (20lbs)', 40, 'Dorm essentials', 'Mason Cole', 'Virginia Tech', 22, 'v13_380'],
];
const colors = ['#edf2ff', '#e9ddff', '#ffe7ed', '#d8f4e8', '#ffe9d4'];
export const initialListings = products.map(([id, title, price, category, seller, campus, likes, image], index) => ({
  id, title, price, category, seller, campus, likes, image: figmaImage(image), initials: seller.charAt(0),
  color: colors[index % colors.length], condition: index % 3 === 0 ? 'Good' : 'Like new',
  location: 'Campus pickup', age: 14 - id, collection: id > 8 ? 'new' : 'trending',
  description: `${title}. A pre-loved campus find looking for its next home. Message ${seller} to confirm the condition and arrange a public campus pickup. This is a sample listing from the Dorm.io design.`,
}));
