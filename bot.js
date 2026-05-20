require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Bot MongoDB Connected'))
  .catch(err => console.log('❌ Bot DB Error:', err));

// Models
const User = mongoose.model('User', new mongoose.Schema({
  name: String, whatsapp: String, password: String, balance: Number,
  totalSpent: Number, totalOrders: Number, lastRewardDate: Date,
  rewardStreak: Number, usedPromoCodes: [String]
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  categoryName: String, serviceName: String, quantity: Number,
  price: Number, link: String, status: String, createdAt: Date
}));

const Deposit = mongoose.model('Deposit', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number, transactionId: String, screenshot: String, status: String
}));

const Category = mongoose.model('Category', new mongoose.Schema({
  name: String, icon: String, enabled: Boolean, order: Number
}));

const Service = mongoose.model('Service', new mongoose.Schema({
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  name: String, pricePerThousand: Number, minQty: Number, maxQty: Number, enabled: Boolean
}));

const PromoCode = mongoose.model('PromoCode', new mongoose.Schema({
  code: String, bonusAmount: Number, maxUses: Number, usedCount: Number, expiresAt: Date, enabled: Boolean
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number, type: String, description: String, balanceAfter: Number
}));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Main Menu
const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📁 Categories', callback_data: 'menu_cat' }, { text: '🛠 Services', callback_data: 'menu_serv' }],
      [{ text: '💰 Deposit Requests', callback_data: 'deposits' }, { text: '🎫 Promo Codes', callback_data: 'promos' }],
      [{ text: '📦 Pending Orders', callback_data: 'orders_pending' }, { text: '📊 Processing Orders', callback_data: 'orders_processing' }]
    ]
  }
};

bot.onText(/\/start/, (msg) => {
  if (msg.chat.id === ADMIN_ID) {
    bot.sendMessage(ADMIN_ID, '👑 Welcome Admin! Control your SMM Panel:', mainMenu);
  }
});

// Handle Callbacks
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  if (chatId !== ADMIN_ID) return;

  // Categories Menu
  if (data === 'menu_cat') {
    const cats = await Category.find().sort('order');
    let text = '📁 *Categories*\n\n';
    for (let c of cats) {
      text += `${c.enabled ? '✅' : '❌'} *${c.name}* (Order: ${c.order})\n`;
    }
    bot.sendMessage(ADMIN_ID, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add Category', callback_data: 'add_cat' }],
          [{ text: '🔘 Toggle Enable/Disable', callback_data: 'toggle_cat' }],
          [{ text: '🔙 Back', callback_data: 'main' }]
        ]
      }
    });
  }
  
  // Add Category
  else if (data === 'add_cat') {
    bot.sendMessage(ADMIN_ID, 'Send category name:');
    bot.once('message', async (m) => {
      const count = await Category.countDocuments();
      await Category.create({ name: m.text, order: count });
      bot.sendMessage(ADMIN_ID, `✅ Category "${m.text}" added!`);
    });
  }
  
  // Toggle Category
  else if (data === 'toggle_cat') {
    const cats = await Category.find();
    let buttons = [];
    for (let c of cats) {
      buttons.push([{ text: `${c.enabled ? '✅' : '❌'} ${c.name}`, callback_data: `toggle_cat_${c._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'menu_cat' }]);
    bot.sendMessage(ADMIN_ID, 'Select category to toggle:', {
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('toggle_cat_')) {
    const id = data.split('_')[2];
    const cat = await Category.findById(id);
    cat.enabled = !cat.enabled;
    await cat.save();
    bot.sendMessage(ADMIN_ID, `✅ Category "${cat.name}" is now ${cat.enabled ? 'ENABLED' : 'DISABLED'}`);
  }
  
  // Services Menu
  else if (data === 'menu_serv') {
    const cats = await Category.find({ enabled: true });
    let buttons = [];
    for (let c of cats) {
      buttons.push([{ text: `${c.name}`, callback_data: `serv_cat_${c._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'main' }]);
    bot.sendMessage(ADMIN_ID, 'Select category to manage services:', {
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('serv_cat_')) {
    const catId = data.split('_')[2];
    const services = await Service.find({ categoryId: catId });
    let text = `🛠 *Services in ${(await Category.findById(catId)).name}*\n\n`;
    for (let s of services) {
      text += `${s.enabled ? '✅' : '❌'} *${s.name}*\n   Price: ₨${s.pricePerThousand}/1k | Min: ${s.minQty} | Max: ${s.maxQty}\n`;
    }
    bot.sendMessage(ADMIN_ID, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add Service', callback_data: `add_serv_${catId}` }],
          [{ text: '✏️ Edit Service', callback_data: `edit_serv_${catId}` }],
          [{ text: '🔘 Toggle Service', callback_data: `toggle_serv_${catId}` }],
          [{ text: '🔙 Back', callback_data: 'menu_serv' }]
        ]
      }
    });
  }
  else if (data.startsWith('add_serv_')) {
    const catId = data.split('_')[2];
    bot.sendMessage(ADMIN_ID, 'Send service details in format:\n`Name, PricePer1000, MinQty, MaxQty`\nExample: TikTok Shares, 50, 100, 10000', { parse_mode: 'Markdown' });
    bot.once('message', async (m) => {
      const parts = m.text.split(',');
      if (parts.length === 4) {
        await Service.create({
          categoryId: catId,
          name: parts[0].trim(),
          pricePerThousand: parseInt(parts[1]),
          minQty: parseInt(parts[2]),
          maxQty: parseInt(parts[3]),
          enabled: true
        });
        bot.sendMessage(ADMIN_ID, `✅ Service "${parts[0].trim()}" added!`);
      } else {
        bot.sendMessage(ADMIN_ID, '❌ Invalid format. Use: Name, Price, Min, Max');
      }
    });
  }
  else if (data.startsWith('toggle_serv_')) {
    const catId = data.split('_')[2];
    const services = await Service.find({ categoryId: catId });
    let buttons = [];
    for (let s of services) {
      buttons.push([{ text: `${s.enabled ? '✅' : '❌'} ${s.name}`, callback_data: `toggle_serv_item_${s._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: `serv_cat_${catId}` }]);
    bot.sendMessage(ADMIN_ID, 'Select service to toggle:', {
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('toggle_serv_item_')) {
    const id = data.split('_')[3];
    const service = await Service.findById(id);
    service.enabled = !service.enabled;
    await service.save();
    bot.sendMessage(ADMIN_ID, `✅ Service "${service.name}" is now ${service.enabled ? 'ENABLED' : 'DISABLED'}`);
  }
  else if (data.startsWith('edit_serv_')) {
    const catId = data.split('_')[2];
    const services = await Service.find({ categoryId: catId });
    let buttons = [];
    for (let s of services) {
      buttons.push([{ text: `✏️ ${s.name}`, callback_data: `edit_serv_item_${s._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: `serv_cat_${catId}` }]);
    bot.sendMessage(ADMIN_ID, 'Select service to edit:', {
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('edit_serv_item_')) {
    const id = data.split('_')[3];
    const service = await Service.findById(id);
    bot.sendMessage(ADMIN_ID, `Editing: ${service.name}\nCurrent: Price=${service.pricePerThousand}, Min=${service.minQty}, Max=${service.maxQty}\n\nSend new values in format:\nPricePer1000, MinQty, MaxQty\nExample: 60, 100, 20000`);
    bot.once('message', async (m) => {
      const parts = m.text.split(',');
      if (parts.length === 3) {
        service.pricePerThousand = parseInt(parts[0]);
        service.minQty = parseInt(parts[1]);
        service.maxQty = parseInt(parts[2]);
        await service.save();
        bot.sendMessage(ADMIN_ID, `✅ Service "${service.name}" updated!`);
      } else {
        bot.sendMessage(ADMIN_ID, '❌ Invalid format. Use: Price, Min, Max');
      }
    });
  }
  
  // Deposit Requests
  else if (data === 'deposits') {
    const pending = await Deposit.find({ status: 'pending' });
    if (pending.length === 0) {
      return bot.sendMessage(ADMIN_ID, 'No pending deposit requests.');
    }
    for (let d of pending) {
      const user = await User.findById(d.userId);
      bot.sendMessage(ADMIN_ID, `💰 *Deposit Request #${d._id}*\nUser: ${user.name} (${user.whatsapp})\nAmount: ₨ ${d.amount}\nTxn ID: ${d.transactionId}\nScreenshot: ${d.screenshot}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Approve', callback_data: `approve_dep_${d._id}` }, { text: '❌ Reject', callback_data: `reject_dep_${d._id}` }]
          ]
        }
      });
    }
  }
  else if (data.startsWith('approve_dep_')) {
    const id = data.split('_')[2];
    const deposit = await Deposit.findById(id);
    const user = await User.findById(deposit.userId);
    user.balance += deposit.amount;
    await user.save();
    deposit.status = 'approved';
    await deposit.save();
    await Transaction.create({
      userId: user._id,
      amount: deposit.amount,
      type: 'deposit',
      description: `Deposit #${id}`,
      balanceAfter: user.balance
    });
    bot.sendMessage(ADMIN_ID, `✅ Deposit #${id} approved! ₨${deposit.amount} added to ${user.name}`);
  }
  else if (data.startsWith('reject_dep_')) {
    const id = data.split('_')[2];
    const deposit = await Deposit.findById(id);
    deposit.status = 'rejected';
    await deposit.save();
    bot.sendMessage(ADMIN_ID, `❌ Deposit #${id} rejected.`);
  }
  
  // Pending Orders
  else if (data === 'orders_pending') {
    const orders = await Order.find({ status: 'pending' });
    if (orders.length === 0) {
      return bot.sendMessage(ADMIN_ID, 'No pending orders.');
    }
    for (let o of orders) {
      const user = await User.findById(o.userId);
      bot.sendMessage(ADMIN_ID, `📦 *Order #${o._id}*\nUser: ${user.name} (${user.whatsapp})\nService: ${o.serviceName}\nQuantity: ${o.quantity}\nPrice: ₨ ${o.price}\nLink: ${o.link}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Approve', callback_data: `approve_order_${o._id}` }, { text: '❌ Reject & Refund', callback_data: `reject_order_${o._id}` }]
          ]
        }
      });
    }
  }
  else if (data.startsWith('approve_order_')) {
    const id = data.split('_')[2];
    const order = await Order.findById(id);
    order.status = 'processing';
    await order.save();
    bot.sendMessage(ADMIN_ID, `✅ Order #${id} approved! Status: PROCESSING\nWhen work is done, press Done:`, {
      reply_markup: {
        inline_keyboard: [[{ text: '✅ Mark as Done (Complete)', callback_data: `done_order_${id}` }]]
      }
    });
  }
  else if (data.startsWith('done_order_')) {
    const id = data.split('_')[2];
    const order = await Order.findById(id);
    order.status = 'completed';
    await order.save();
    bot.sendMessage(ADMIN_ID, `✅ Order #${id} COMPLETED!`);
  }
  else if (data.startsWith('reject_order_')) {
    const id = data.split('_')[2];
    const order = await Order.findById(id);
    const user = await User.findById(order.userId);
    user.balance += order.price;
    await user.save();
    order.status = 'rejected';
    await order.save();
    await Transaction.create({
      userId: user._id,
      amount: order.price,
      type: 'refund',
      description: `Refund for Order #${id}`,
      balanceAfter: user.balance
    });
    bot.sendMessage(ADMIN_ID, `❌ Order #${id} rejected. Refunded ₨${order.price} to ${user.name}`);
  }
  
  // Processing Orders
  else if (data === 'orders_processing') {
    const orders = await Order.find({ status: 'processing' });
    if (orders.length === 0) {
      return bot.sendMessage(ADMIN_ID, 'No processing orders.');
    }
    for (let o of orders) {
      const user = await User.findById(o.userId);
      bot.sendMessage(ADMIN_ID, `⚙️ *Processing Order #${o._id}*\nUser: ${user.name}\nService: ${o.serviceName}\nQty: ${o.quantity}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '✅ Complete Order', callback_data: `done_order_${o._id}` }]]
        }
      });
    }
  }
  
  // Promo Codes Menu
  else if (data === 'promos') {
    const promos = await PromoCode.find();
    let text = '🎫 *Promo Codes*\n\n';
    for (let p of promos) {
      text += `📌 *${p.code}*: ₨${p.bonusAmount} bonus | Used: ${p.usedCount}/${p.maxUses || '∞'} | Expires: ${p.expiresAt ? p.expiresAt.toDateString() : 'Never'} | ${p.enabled ? '✅ Active' : '❌ Disabled'}\n`;
    }
    bot.sendMessage(ADMIN_ID, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Create Promo Code', callback_data: 'create_promo' }],
          [{ text: '🔘 Toggle Promo Code', callback_data: 'toggle_promo' }],
          [{ text: '🔙 Back', callback_data: 'main' }]
        ]
      }
    });
  }
  else if (data === 'create_promo') {
    bot.sendMessage(ADMIN_ID, 'Send promo code details in format:\n`Code, BonusAmount, MaxUses, ExpiryDate(YYYY-MM-DD)`\nExample: SUMMER50, 100, 50, 2026-12-31\n(For no expiry, write "never")');
    bot.once('message', async (m) => {
      const parts = m.text.split(',');
      if (parts.length >= 3) {
        const expiresAt = parts[3] && parts[3].trim() !== 'never' ? new Date(parts[3].trim()) : null;
        await PromoCode.create({
          code: parts[0].trim().toUpperCase(),
          bonusAmount: parseInt(parts[1]),
          maxUses: parseInt(parts[2]),
          expiresAt: expiresAt,
          enabled: true
        });
        bot.sendMessage(ADMIN_ID, `✅ Promo code "${parts[0].trim().toUpperCase()}" created!`);
      } else {
        bot.sendMessage(ADMIN_ID, '❌ Invalid format. Use: Code, Bonus, MaxUses, ExpiryDate');
      }
    });
  }
  else if (data === 'toggle_promo') {
    const promos = await PromoCode.find();
    let buttons = [];
    for (let p of promos) {
      buttons.push([{ text: `${p.enabled ? '✅' : '❌'} ${p.code}`, callback_data: `toggle_promo_${p._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'promos' }]);
    bot.sendMessage(ADMIN_ID, 'Select promo code to toggle:', {
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('toggle_promo_')) {
    const id = data.split('_')[2];
    const promo = await PromoCode.findById(id);
    promo.enabled = !promo.enabled;
    await promo.save();
    bot.sendMessage(ADMIN_ID, `✅ Promo "${promo.code}" is now ${promo.enabled ? 'ACTIVE' : 'INACTIVE'}`);
  }
  
  // Main Menu
  else if (data === 'main') {
    bot.sendMessage(ADMIN_ID, '👑 Main Menu:', mainMenu);
  }
});

console.log('🤖 Telegram Admin Bot is running...');
