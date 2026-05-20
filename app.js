require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();

// ============ MIDDLEWARE ============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ============ DATABASE CONNECTION ============
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.log('❌ MongoDB Error:', err));

// ============ MODELS ============
const UserSchema = new mongoose.Schema({
  name: String,
  whatsapp: { type: String, unique: true },
  password: String,
  balance: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },
  lastRewardDate: Date,
  rewardStreak: { type: Number, default: 0 },
  usedPromoCodes: [String],
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const CategorySchema = new mongoose.Schema({
  name: String,
  icon: String,
  enabled: { type: Boolean, default: true },
  order: { type: Number, default: 0 }
});
const Category = mongoose.model('Category', CategorySchema);

const ServiceSchema = new mongoose.Schema({
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  name: String,
  pricePerThousand: Number,
  minQty: Number,
  maxQty: Number,
  enabled: { type: Boolean, default: true }
});
const Service = mongoose.model('Service', ServiceSchema);

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  categoryName: String,
  serviceName: String,
  quantity: Number,
  price: Number,
  link: String,
  status: { type: String, enum: ['pending', 'processing', 'completed', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number,
  type: { type: String, enum: ['deposit', 'order', 'reward', 'refund'] },
  description: String,
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  balanceAfter: Number,
  createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', TransactionSchema);

const DepositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number,
  transactionId: String,
  screenshot: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', DepositSchema);

const PromoCodeSchema = new mongoose.Schema({
  code: String,
  bonusAmount: Number,
  maxUses: Number,
  usedCount: { type: Number, default: 0 },
  expiresAt: Date,
  enabled: { type: Boolean, default: true }
});
const PromoCode = mongoose.model('PromoCode', PromoCodeSchema);

// ============ AUTH MIDDLEWARE ============
const requireLogin = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  next();
};

// ============ ROUTES ============

// Auth Routes
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('index', { page: 'login', user: null, error: null, success: null });
});

app.post('/login', async (req, res) => {
  const { whatsapp, password } = req.body;
  const user = await User.findOne({ whatsapp });
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.userId = user._id;
    res.redirect('/dashboard');
  } else {
    res.render('index', { page: 'login', user: null, error: 'Invalid WhatsApp or Password', success: null });
  }
});

app.get('/signup', (req, res) => {
  res.render('index', { page: 'signup', user: null, error: null, success: null });
});

app.post('/signup', async (req, res) => {
  const { name, whatsapp, password } = req.body;
  const existing = await User.findOne({ whatsapp });
  if (existing) {
    return res.render('index', { page: 'signup', user: null, error: 'WhatsApp already registered', success: null });
  }
  const hashed = bcrypt.hashSync(password, 10);
  const user = new User({ name, whatsapp, password: hashed });
  await user.save();
  req.session.userId = user._id;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Dashboard
app.get('/dashboard', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('index', { page: 'dashboard', user, error: null, success: null });
});

// Services - Categories
app.get('/services', requireLogin, async (req, res) => {
  const categories = await Category.find({ enabled: true }).sort('order');
  res.render('index', { page: 'categories', user: await User.findById(req.session.userId), categories, error: null, success: null });
});

// Services list by category
app.get('/services/:categoryId', requireLogin, async (req, res) => {
  const category = await Category.findById(req.params.categoryId);
  const services = await Service.find({ categoryId: category._id, enabled: true });
  res.render('index', { page: 'services', user: await User.findById(req.session.userId), category, services, error: null, success: null });
});

// Order page
app.get('/order/:serviceId', requireLogin, async (req, res) => {
  const service = await Service.findById(req.params.serviceId).populate('categoryId');
  const user = await User.findById(req.session.userId);
  res.render('index', { page: 'order', user, service, error: null, success: null });
});

// Place Order API
app.post('/api/place-order', requireLogin, async (req, res) => {
  const { serviceId, link, quantity } = req.body;
  const service = await Service.findById(serviceId);
  const user = await User.findById(req.session.userId);
  
  const qty = parseInt(quantity);
  if (qty < service.minQty || qty > service.maxQty) {
    return res.json({ error: `Quantity must be between ${service.minQty} and ${service.maxQty}` });
  }
  
  const price = Math.floor((service.pricePerThousand * qty) / 1000);
  
  if (user.balance < price) {
    return res.json({ error: 'Insufficient balance. Please deposit funds.' });
  }
  
  user.balance -= price;
  user.totalSpent += price;
  user.totalOrders += 1;
  await user.save();
  
  const order = new Order({
    userId: user._id,
    categoryName: service.categoryId.name,
    serviceName: service.name,
    quantity: qty,
    price: price,
    link: link,
    status: 'pending'
  });
  await order.save();
  
  await Transaction.create({
    userId: user._id,
    amount: price,
    type: 'order',
    description: `Order #${order._id} - ${service.name} x${qty}`,
    balanceAfter: user.balance
  });
  
  res.json({ success: true, orderId: order._id });
});

// Order History
app.get('/order-history', requireLogin, async (req, res) => {
  const orders = await Order.find({ userId: req.session.userId }).sort('-createdAt');
  res.render('index', { page: 'order-history', user: await User.findById(req.session.userId), orders, error: null, success: null });
});

// Balance History
app.get('/balance-history', requireLogin, async (req, res) => {
  const transactions = await Transaction.find({ userId: req.session.userId }).sort('-createdAt');
  res.render('index', { page: 'balance-history', user: await User.findById(req.session.userId), transactions, error: null, success: null });
});

// Deposit Page
app.get('/deposit', requireLogin, (req, res) => {
  res.render('index', { page: 'deposit', user: null, error: null, success: null });
});

// Deposit Request API
app.post('/api/deposit-request', requireLogin, async (req, res) => {
  const { amount, transactionId, screenshot } = req.body;
  await Deposit.create({
    userId: req.session.userId,
    amount: parseInt(amount),
    transactionId,
    screenshot
  });
  res.json({ success: true });
});

// Daily Reward
app.get('/api/daily-reward', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const today = new Date().toDateString();
  const last = user.lastRewardDate ? new Date(user.lastRewardDate).toDateString() : null;
  
  if (last === today) {
    return res.json({ error: 'You already claimed today\'s reward' });
  }
  
  let rewardAmount = 1;
  let newStreak = 0;
  
  if (user.lastRewardDate) {
    const daysDiff = Math.floor((new Date() - new Date(user.lastRewardDate)) / (1000 * 60 * 60 * 24));
    if (daysDiff === 1) {
      newStreak = Math.min((user.rewardStreak || 0) + 1, 6);
      const rewards = [1, 1, 1, 1, 2, 2, 2];
      rewardAmount = rewards[newStreak];
    }
  }
  
  user.balance += rewardAmount;
  user.lastRewardDate = new Date();
  user.rewardStreak = newStreak;
  await user.save();
  
  await Transaction.create({
    userId: user._id,
    amount: rewardAmount,
    type: 'reward',
    description: `Daily Reward - Day ${newStreak + 1}`,
    balanceAfter: user.balance
  });
  
  res.json({ success: true, amount: rewardAmount, balance: user.balance });
});

// Promo Page
app.get('/promo', requireLogin, (req, res) => {
  res.render('index', { page: 'promo', user: null, error: null, success: null });
});

// Redeem Promo API
app.post('/api/redeem-promo', requireLogin, async (req, res) => {
  const { code } = req.body;
  const user = await User.findById(req.session.userId);
  const promo = await PromoCode.findOne({ code: code.toUpperCase(), enabled: true });
  
  if (!promo) return res.json({ error: 'Invalid promo code' });
  if (promo.expiresAt && new Date() > promo.expiresAt) return res.json({ error: 'Promo code expired' });
  if (promo.maxUses && promo.usedCount >= promo.maxUses) return res.json({ error: 'Promo code fully used' });
  if (user.usedPromoCodes.includes(promo._id.toString())) return res.json({ error: 'You already used this code' });
  
  user.balance += promo.bonusAmount;
  user.usedPromoCodes.push(promo._id);
  await user.save();
  
  promo.usedCount += 1;
  await promo.save();
  
  await Transaction.create({
    userId: user._id,
    amount: promo.bonusAmount,
    type: 'deposit',
    description: `Promo Code: ${code}`,
    balanceAfter: user.balance
  });
  
  res.json({ success: true, amount: promo.bonusAmount, balance: user.balance });
});

// Support Page (AI Chatbot)
app.get('/support', requireLogin, (req, res) => {
  res.render('index', { page: 'support', user: null, error: null, success: null });
});

// AI Chatbot API
app.post('/api/chat', requireLogin, async (req, res) => {
  const { message } = req.body;
  const userId = req.session.userId;
  const user = await User.findById(userId);
  const msg = message.toLowerCase();
  
  let reply = '';
  
  if (msg.includes('balance') || msg.includes('بیلنس')) {
    reply = `Your current balance is ₨ ${user.balance.toLocaleString()}`;
  } else if (msg.includes('spent') || msg.includes('خرچ')) {
    reply = `You have spent a total of ₨ ${user.totalSpent.toLocaleString()}`;
  } else if (msg.includes('orders') || msg.includes('آرڈر') || msg.includes('order')) {
    reply = `You have placed ${user.totalOrders} orders in total.`;
  } else if (msg.includes('price') || msg.includes('قیمت')) {
    const services = await Service.find({ enabled: true }).limit(5);
    reply = `💰 Service Prices (per 1000):\n`;
    services.forEach(s => {
      reply += `• ${s.name}: ₨ ${s.pricePerThousand} (Min: ${s.minQty}, Max: ${s.maxQty})\n`;
    });
  } else if (msg.includes('min') || msg.includes('max') || msg.includes('کم از کم')) {
    reply = `Each service has min/max limits. Go to Services → Select any service → You'll see the limits there.`;
  } else if (msg.includes('deposit') || msg.includes('ڈیپازٹ')) {
    reply = `To add funds: Go to Deposit Fund → Scan QR code → Send payment → Submit Transaction ID & Screenshot → Admin will approve within 24 hours.`;
  } else if (msg.includes('reward') || msg.includes('ریوارڈ')) {
    reply = `Daily Reward: Claim once every day. Week 1: 1,1,1,1,2,2,2 = Total 10 PKR! Go to Daily Reward button.`;
  } else if (msg.includes('hi') || msg.includes('hello') || msg.includes('assalam') || msg.includes('السلام')) {
    reply = `👋 Welcome! I'm your AI assistant. You can ask me about:\n• Your balance\n• Service prices\n• How to deposit\n• Order status\n• Daily rewards\n\nHow can I help you today?`;
  } else {
    reply = `🤖 I'm still learning! For quick help:\n• "My balance"\n• "Service prices"\n• "How to deposit"\n• "Daily reward"\n\nOr contact Admin via WhatsApp in Support page.`;
  }
  
  res.json({ reply });
});

// Bulk Order Page
app.get('/bulk-order', requireLogin, async (req, res) => {
  const services = await Service.find({ enabled: true }).populate('categoryId');
  res.render('index', { page: 'bulk', user: await User.findById(req.session.userId), services, error: null, success: null });
});

// Bulk Order API
app.post('/api/bulk-order', requireLogin, async (req, res) => {
  const { orders } = req.body;
  const user = await User.findById(req.session.userId);
  let totalPrice = 0;
  const orderList = [];
  
  for (const ord of orders) {
    const service = await Service.findById(ord.serviceId);
    if (service) {
      const qty = parseInt(ord.quantity);
      if (qty >= service.minQty && qty <= service.maxQty) {
        const price = Math.floor((service.pricePerThousand * qty) / 1000);
        totalPrice += price;
        orderList.push({ service, qty, price, link: ord.link });
      }
    }
  }
  
  if (user.balance < totalPrice) {
    return res.json({ error: `Insufficient balance. Need ₨ ${totalPrice}` });
  }
  
  user.balance -= totalPrice;
  user.totalSpent += totalPrice;
  user.totalOrders += orderList.length;
  await user.save();
  
  for (const item of orderList) {
    const order = new Order({
      userId: user._id,
      categoryName: item.service.categoryId.name,
      serviceName: item.service.name,
      quantity: item.qty,
      price: item.price,
      link: item.link,
      status: 'pending'
    });
    await order.save();
  }
  
  res.json({ success: true, totalPrice, ordersCount: orderList.length, newBalance: user.balance });
});

// ============ INITIALIZE DEFAULT DATA ============
const initData = async () => {
  const catCount = await Category.countDocuments();
  if (catCount === 0) {
    // Create categories
    const tiktok = await Category.create({ name: 'TikTok', order: 1 });
    const whatsapp = await Category.create({ name: 'WhatsApp', order: 2 });
    const facebook = await Category.create({ name: 'Facebook', order: 3 });
    const instagram = await Category.create({ name: 'Instagram', order: 4 });
    const youtube = await Category.create({ name: 'YouTube', order: 5 });
    
    // Create services for TikTok
    await Service.create({ categoryId: tiktok._id, name: 'TikTok Likes', pricePerThousand: 43, minQty: 100, maxQty: 10000 });
    await Service.create({ categoryId: tiktok._id, name: 'TikTok Followers', pricePerThousand: 820, minQty: 50, maxQty: 10000 });
    await Service.create({ categoryId: tiktok._id, name: 'TikTok Views', pricePerThousand: 23, minQty: 100, maxQty: 1000000 });
    
    // Create services for WhatsApp
    await Service.create({ categoryId: whatsapp._id, name: 'WhatsApp Channel Reactions', pricePerThousand: 50, minQty: 100, maxQty: 50000 });
    await Service.create({ categoryId: whatsapp._id, name: 'WhatsApp Channel Followers', pricePerThousand: 100, minQty: 50, maxQty: 50000 });
    await Service.create({ categoryId: whatsapp._id, name: 'WhatsApp Poll Votes', pricePerThousand: 30, minQty: 100, maxQty: 10000 });
    
    // Create services for Facebook
    await Service.create({ categoryId: facebook._id, name: 'Facebook Likes', pricePerThousand: 35, minQty: 100, maxQty: 50000 });
    await Service.create({ categoryId: facebook._id, name: 'Facebook Followers', pricePerThousand: 60, minQty: 50, maxQty: 50000 });
    
    // Create services for Instagram
    await Service.create({ categoryId: instagram._id, name: 'Instagram Likes', pricePerThousand: 40, minQty: 100, maxQty: 50000 });
    await Service.create({ categoryId: instagram._id, name: 'Instagram Followers', pricePerThousand: 80, minQty: 50, maxQty: 50000 });
    await Service.create({ categoryId: instagram._id, name: 'Instagram Views', pricePerThousand: 25, minQty: 100, maxQty: 100000 });
    
    // Create services for YouTube
    await Service.create({ categoryId: youtube._id, name: 'YouTube Subscribers', pricePerThousand: 500, minQty: 50, maxQty: 10000 });
    await Service.create({ categoryId: youtube._id, name: 'YouTube Likes', pricePerThousand: 45, minQty: 100, maxQty: 50000 });
    await Service.create({ categoryId: youtube._id, name: 'YouTube Views', pricePerThousand: 20, minQty: 100, maxQty: 1000000 });
    
    // Create test promo code
    await PromoCode.create({ code: 'WELCOME50', bonusAmount: 50, maxUses: 100, expiresAt: new Date('2026-12-31') });
    
    console.log('✅ Default categories and services created');
  }
};
initData();

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
