import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = 'supersecretkey'; // Change in production
const PORT = 3000;

// --- SQLite Setup ---
const db = new Database('ecommerce.sqlite');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  FOREIGN KEY(cart_id) REFERENCES carts(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  total REAL NOT NULL,
  date TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

// --- Middleware ---
function authRequired(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'No token' });
  const token = auth.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden: Insufficient role' });
    }
    next();
  };
}

// --- Auth ---
app.post('/register', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  if (!['customer', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const exists = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: 'User exists' });
  const hash = await bcrypt.hash(password, 8);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);
  res.json({ message: 'Registered' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token });
});

// --- Product Endpoints ---
app.get('/products', (req, res) => {
  let { page = 1, limit = 10, search = '', category = '' } = req.query;
  page = parseInt(page);
  limit = parseInt(limit);
  let where = [];
  let params = [];
  if (search) {
    where.push('LOWER(name) LIKE ?');
    params.push(`%${search.toLowerCase()}%`);
  }
  if (category) {
    where.push('LOWER(category) = ?');
    params.push(category.toLowerCase());
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as count FROM products ${whereClause}`).get(...params).count;
  const products = db.prepare(`SELECT * FROM products ${whereClause} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  res.json({ products, total });
});

app.get('/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  res.json(product);
});

app.post('/products', authRequired, requireRole('admin'), (req, res) => {
  const { name, category, price } = req.body;
  if (!name || !category || price == null) return res.status(400).json({ error: 'Missing fields' });
  const info = db.prepare('INSERT INTO products (name, category, price) VALUES (?, ?, ?)').run(name, category, price);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(product);
});

app.put('/products/:id', authRequired, requireRole('admin'), (req, res) => {
  const { name, category, price } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE products SET name = COALESCE(?, name), category = COALESCE(?, category), price = COALESCE(?, price) WHERE id = ?')
    .run(name, category, price, req.params.id);
  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(updated);
});

app.delete('/products/:id', authRequired, requireRole('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

// --- Cart Endpoints ---
function getOrCreateCart(userId) {
  let cart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(userId);
  if (!cart) {
    const info = db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(userId);
    cart = { id: info.lastInsertRowid, user_id: userId };
  }
  return cart;
}

app.get('/cart', authRequired, (req, res) => {
  const cart = getOrCreateCart(req.user.id);
  const items = db.prepare(`SELECT ci.product_id, ci.quantity, p.name, p.price, p.category FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.cart_id = ?`).all(cart.id);
  res.json(items);
});

app.post('/cart', authRequired, (req, res) => {
  const { productId, quantity } = req.body;
  if (!productId || !quantity) return res.status(400).json({ error: 'Missing fields' });
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const cart = getOrCreateCart(req.user.id);
  const item = db.prepare('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?').get(cart.id, productId);
  if (item) {
    db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(quantity, item.id);
  } else {
    db.prepare('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)').run(cart.id, productId, quantity);
  }
  const items = db.prepare(`SELECT ci.product_id, ci.quantity, p.name, p.price, p.category FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.cart_id = ?`).all(cart.id);
  res.json(items);
});

app.put('/cart/:productId', authRequired, (req, res) => {
  const { quantity } = req.body;
  const cart = getOrCreateCart(req.user.id);
  const item = db.prepare('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?').get(cart.id, req.params.productId);
  if (!item) return res.status(404).json({ error: 'Item not in cart' });
  if (quantity <= 0) {
    db.prepare('DELETE FROM cart_items WHERE id = ?').run(item.id);
  } else {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(quantity, item.id);
  }
  const items = db.prepare(`SELECT ci.product_id, ci.quantity, p.name, p.price, p.category FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.cart_id = ?`).all(cart.id);
  res.json(items);
});

app.delete('/cart/:productId', authRequired, (req, res) => {
  const cart = getOrCreateCart(req.user.id);
  db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(cart.id, req.params.productId);
  const items = db.prepare(`SELECT ci.product_id, ci.quantity, p.name, p.price, p.category FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.cart_id = ?`).all(cart.id);
  res.json(items);
});

// --- Order Endpoints ---
app.post('/orders', authRequired, (req, res) => {
  const cart = getOrCreateCart(req.user.id);
  const items = db.prepare(`SELECT ci.product_id, ci.quantity, p.name, p.price FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.cart_id = ?`).all(cart.id);
  if (!items.length) return res.status(400).json({ error: 'Cart is empty' });
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const orderInfo = db.prepare('INSERT INTO orders (user_id, total, date) VALUES (?, ?, ?)').run(req.user.id, total, new Date().toISOString());
  const orderId = orderInfo.lastInsertRowid;
  const insertOrderItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)');
  for (const i of items) {
    insertOrderItem.run(orderId, i.product_id, i.name, i.price, i.quantity);
  }
  db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
  res.status(201).json({ id: orderId, items, total, date: new Date().toISOString() });
});

app.get('/orders', authRequired, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ?').all(req.user.id);
  const getOrderItems = db.prepare('SELECT product_id, name, price, quantity FROM order_items WHERE order_id = ?');
  const result = orders.map(order => ({
    ...order,
    items: getOrderItems.all(order.id)
  }));
  res.json(result);
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 