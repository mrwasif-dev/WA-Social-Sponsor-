require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

// ============ DATABASE CONNECTION ============
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smm_panel';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000
})
.then(() => console.log('✅ Bot: MongoDB Connected'))
.catch(err => console.error('❌ Bot: MongoDB Error:', err));

// ============ MODELS ============
const UserSchema = new mongoose.Schema({
  name: String,
  whatsapp: String,
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

const DepositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number,
  transactionId: String,
  screenshot: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', DepositSchema);

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number,
  type: String,
  description: String,
  balanceAfter: Number,
  createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', TransactionSchema);

const PromoCodeSchema = new mongoose.Schema({
  code: String,
  bonusAmount: Number,
  maxUses: Number,
  usedCount: { type: Number, default: 0 },
  expiresAt: Date,
  enabled: { type: Boolean, default: true }
});
const PromoCode = mongoose.model('PromoCode', PromoCodeSchema);

// ============ BOT CONFIGURATION ============
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error('❌ Please set TELEGRAM_BOT_TOKEN in .env file');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ============ MAIN MENU ============
const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📁 Manage Categories', callback_data: 'menu_cat' }, { text: '🛠 Manage Services', callback_data: 'menu_serv' }],
      [{ text: '💰 Deposit Requests', callback_data: 'deposits' }, { text: '🎫 Promo Codes', callback_data: 'promos' }],
      [{ text: '📦 Pending Orders', callback_data: 'orders_pending' }, { text: '⚙️ Processing Orders', callback_data: 'orders_processing' }],
      [{ text: '📊 Statistics', callback_data: 'stats' }]
    ]
  }
};

// ============ START COMMAND ============
bot.onText(/\/start/, (msg) => {
  if (msg.chat.id === ADMIN_ID) {
    bot.sendMessage(ADMIN_ID, '👑 *Welcome Admin!*\n\nControl your SMM Panel from here:\n✅ Manage Categories & Services\n✅ Approve/Reject Deposits\n✅ Approve/Complete Orders\n✅ Create Promo Codes\n\nSelect an option below:', {
      parse_mode: 'Markdown',
      ...mainMenu
    });
  } else {
    bot.sendMessage(msg.chat.id, '❌ You are not authorized to use this bot.');
  }
});

// ============ CALLBACK QUERY HANDLER ============
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  
  if (chatId !== ADMIN_ID) {
    return bot.answerCallbackQuery(query.id, { text: 'Unauthorized!' });
  }

  // ============ CATEGORIES MENU ============
  if (data === 'menu_cat') {
    const cats = await Category.find().sort('order');
    let text = '📁 *Categories Management*\n\n';
    for (let c of cats) {
      text += `${c.enabled ? '✅' : '❌'} *${c.name}* (Order: ${c.order})\n`;
    }
    text += '\nWhat would you like to do?';
    
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add Category', callback_data: 'add_cat' }],
          [{ text: '🔘 Enable/Disable Category', callback_data: 'toggle_cat' }],
          [{ text: '🗑 Delete Category', callback_data: 'delete_cat' }],
          [{ text: '🔙 Back to Main Menu', callback_data: 'main' }]
        ]
      }
    });
  }
  
  // Add Category
  else if (data === 'add_cat') {
    bot.sendMessage(ADMIN_ID, '📝 *Send category name:*\nExample: Snapchat, Twitter, LinkedIn', { parse_mode: 'Markdown' });
    bot.once('message', async (m) => {
      if (m.text && !m.text.startsWith('/')) {
        const count = await Category.countDocuments();
        await Category.create({ name: m.text, order: count });
        bot.sendMessage(ADMIN_ID, `✅ Category "${m.text}" added successfully!`);
      } else {
        bot.sendMessage(ADMIN_ID, '❌ Invalid category name.');
      }
    });
  }
  
  // Toggle Category (Enable/Disable)
  else if (data === 'toggle_cat') {
    const cats = await Category.find().sort('order');
    let buttons = [];
    for (let c of cats) {
      buttons.push([{ text: `${c.enabled ? '✅' : '❌'} ${c.name}`, callback_data: `toggle_cat_${c._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'menu_cat' }]);
    
    bot.editMessageText('📁 *Select category to toggle (Enable/Disable):*', {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('toggle_cat_')) {
    const id = data.split('_')[2];
    const cat = await Category.findById(id);
    cat.enabled = !cat.enabled;
    await cat.save();
    bot.answerCallbackQuery(query.id, { text: `Category ${cat.enabled ? 'Enabled' : 'Disabled'}!` });
    bot.sendMessage(ADMIN_ID, `✅ Category "${cat.name}" is now ${cat.enabled ? 'ENABLED' : 'DISABLED'}`);
  }
  
  // Delete Category
  else if (data === 'delete_cat') {
    const cats = await Category.find().sort('order');
    let buttons = [];
    for (let c of cats) {
      buttons.push([{ text: `🗑 ${c.name}`, callback_data: `delete_cat_${c._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'menu_cat' }]);
    
    bot.editMessageText('⚠️ *Select category to DELETE:*\n(This will also delete all services in this category)', {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('delete_cat_')) {
    const id = data.split('_')[2];
    const cat = await Category.findById(id);
    await Service.deleteMany({ categoryId: id });
    await Category.findByIdAndDelete(id);
    bot.answerCallbackQuery(query.id, { text: `Category "${cat.name}" deleted!` });
    bot.sendMessage(ADMIN_ID, `🗑 Category "${cat.name}" and all its services have been deleted.`);
  }
  
  // ============ SERVICES MENU ============
  else if (data === 'menu_serv') {
    const cats = await Category.find({ enabled: true });
    let buttons = [];
    for (let c of cats) {
      buttons.push([{ text: `${c.name}`, callback_data: `serv_cat_${c._id}` }]);
    }
    buttons.push([{ text: '🔙 Back to Main Menu', callback_data: 'main' }]);
    
    bot.editMessageText('🛠 *Select a category to manage its services:*', {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('serv_cat_')) {
    const catId = data.split('_')[2];
    const category = await Category.findById(catId);
    const services = await Service.find({ categoryId: catId });
    
    let text = `🛠 *Services in ${category.name}*\n\n`;
    for (let s of services) {
      text += `${s.enabled ? '✅' : '❌'} *${s.name}*\n`;
      text += `   📍 Price: ₨${s.pricePerThousand}/1k | Min: ${s.minQty} | Max: ${s.maxQty}\n\n`;
    }
    
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add Service', callback_data: `add_serv_${catId}` }],
          [{ text: '✏️ Edit Service', callback_data: `edit_serv_${catId}` }],
          [{ text: '🔘 Enable/Disable Service', callback_data: `toggle_serv_${catId}` }],
          [{ text: '🗑 Delete Service', callback_data: `del_serv_${catId}` }],
          [{ text: '🔙 Back to Categories', callback_data: 'menu_serv' }]
        ]
      }
    });
  }
  
  // Add Service
  else if (data.startsWith('add_serv_')) {
    const catId = data.split('_')[2];
    bot.sendMessage(ADMIN_ID, '📝 *Add new service*\n\nSend details in this format:\n`Name, PricePer1000, MinQty, MaxQty`\n\nExample:\n`TikTok Shares, 50, 100, 10000`', { parse_mode: 'Markdown' });
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
        bot.sendMessage(ADMIN_ID, `✅ Service "${parts[0].trim()}" added successfully!`);
      } else {
        bot.sendMessage(ADMIN_ID, '❌ Invalid format. Use: Name, Price, Min, Max');
      }
    });
  }
  
  // Edit Service
  else if (data.startsWith('edit_serv_')) {
    const catId = data.split('_')[2];
    const services = await Service.find({ categoryId: catId });
    let buttons = [];
    for (let s of services) {
      buttons.push([{ text: `✏️ ${s.name}`, callback_data: `edit_serv_item_${s._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: `serv_cat_${catId}` }]);
    
    bot.editMessageText('✏️ *Select service to edit:*', {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('edit_serv_item_')) {
    const id = data.split('_')[3];
    const service = await Service.findById(id);
    bot.sendMessage(ADMIN_ID, `✏️ *Editing:* ${service.name}\n\nCurrent values:\n💰 Price: ₨${service.pricePerThousand}/1k\n📉 Min Qty: ${service.minQty}\n📈 Max Qty: ${service.maxQty}\n\nSend new values in format:\n\`PricePer1000, MinQty, MaxQty\`\nExample: \`60, 100, 20000\``, { parse_mode: 'Markdown' });
    bot.once('message', async (m) => {
      const parts = m.text.split(',');
      if (parts.length === 3) {
        service.pricePerThousand = parseInt(parts[0]);
        service.minQty = parseInt(parts[1]);
        service.maxQty = parseInt(parts[2]);
        await service.save();
        bot.sendMessage(ADMIN_ID, `✅ Service "${service.name}" updated successfully!`);
      } else {
        bot.sendMessage(ADMIN_ID, '❌ Invalid format. Use: Price, Min, Max');
      }
    });
  }
  
  // Toggle Service (Enable/Disable)
  else if (data.startsWith('toggle_serv_')) {
    const catId = data.split('_')[2];
    const services = await Service.find({ categoryId: catId });
    let buttons = [];
    for (let s of services) {
      buttons.push([{ text: `${s.enabled ? '✅' : '❌'} ${s.name}`, callback_data: `toggle_serv_item_${s._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: `serv_cat_${catId}` }]);
    
    bot.editMessageText('🔘 *Select service to enable/disable:*', {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('toggle_serv_item_')) {
    const id = data.split('_')[3];
    const service = await Service.findById(id);
    service.enabled = !service.enabled;
    await service.save();
    bot.answerCallbackQuery(query.id, { text: `Service ${service.enabled ? 'Enabled' : 'Disabled'}!` });
    bot.sendMessage(ADMIN_ID, `✅ Service "${service.name}" is now ${service.enabled ? 'ENABLED' : 'DISABLED'}`);
  }
  
  // Delete Service
  else if (data.startsWith('del_serv_')) {
    const catId = data.split('_')[2];
    const services = await Service.find({ categoryId: catId });
    let buttons = [];
    for (let s of services) {
      buttons.push([{ text: `🗑 ${s.name}`, callback_data: `del_serv_item_${s._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: `serv_cat_${catId}` }]);
    
    bot.editMessageText('⚠️ *Select service to DELETE:*', {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('del_serv_item_')) {
    const id = data.split('_')[3];
    const service = await Service.findById(id);
    await Service.findByIdAndDelete(id);
    bot.answerCallbackQuery(query.id, { text: `Service "${service.name}" deleted!` });
    bot.sendMessage(ADMIN_ID, `🗑 Service "${service.name}" has been deleted.`);
  }
  
  // ============ DEPOSIT REQUESTS ============
  else if (data === 'deposits') {
    const pending = await Deposit.find({ status: 'pending' }).sort('-createdAt');
    if (pending.length === 0) {
      bot.editMessageText('💰 *No pending deposit requests.*\n\nAll deposits have been processed.', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'main' }]] }
      });
    } else {
      bot.editMessageText(`💰 *Deposit Requests*\n\nTotal pending: ${pending.length}\n\nProcessing one by one:`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '📋 View All', callback_data: 'view_deposits' }]] }
      });
    }
  }
  else if (data === 'view_deposits') {
    const pending = await Deposit.find({ status: 'pending' }).sort('-createdAt');
    for (let d of pending) {
      const user = await User.findById(d.userId);
      bot.sendMessage(ADMIN_ID, `💰 *Deposit Request #${d._id.toString().slice(-6)}*\n\n👤 User: ${user.name}\n📞 WhatsApp: ${user.whatsapp}\n💵 Amount: ₨ ${d.amount.toLocaleString()}\n🆔 Transaction ID: ${d.transactionId}\n📸 Screenshot: ${d.screenshot}\n📅 Date: ${new Date(d.createdAt).toLocaleString()}\n\n⚠️ Verify the screenshot before approving.`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Approve', callback_data: `approve_dep_${d._id}` }, { text: '❌ Reject', callback_data: `reject_dep_${d._id}` }]
          ]
        }
      });
    }
    bot.sendMessage(ADMIN_ID, '📋 *End of deposit requests*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'main' }]] } });
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
      description: `Deposit #${deposit._id}`,
      balanceAfter: user.balance
    });
    
    bot.answerCallbackQuery(query.id, { text: `Approved! ₨${deposit.amount} added to ${user.name}` });
    bot.sendMessage(ADMIN_ID, `✅ *Deposit Approved!*\n\n👤 User: ${user.name}\n💰 Amount: ₨ ${deposit.amount}\n💳 New Balance: ₨ ${user.balance}`, { parse_mode: 'Markdown' });
  }
  else if (data.startsWith('reject_dep_')) {
    const id = data.split('_')[2];
    const deposit = await Deposit.findById(id);
    deposit.status = 'rejected';
    await deposit.save();
    bot.answerCallbackQuery(query.id, { text: 'Deposit rejected!' });
    bot.sendMessage(ADMIN_ID, `❌ *Deposit Rejected*\n\nRequest #${deposit._id} has been rejected.`, { parse_mode: 'Markdown' });
  }
  
  // ============ PENDING ORDERS ============
  else if (data === 'orders_pending') {
    const orders = await Order.find({ status: 'pending' }).sort('-createdAt');
    if (orders.length === 0) {
      bot.editMessageText('📦 *No pending orders.*', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'main' }]] }
      });
    } else {
      for (let o of orders) {
        const user = await User.findById(o.userId);
        bot.sendMessage(ADMIN_ID, `📦 *Order #${o._id.toString().slice(-6)}*\n\n👤 User: ${user.name} (${user.whatsapp})\n📋 Service: ${o.serviceName}\n🔢 Quantity: ${o.quantity.toLocaleString()}\n💰 Price: ₨ ${o.price}\n🔗 Link: ${o.link}\n📅 Date: ${new Date(o.createdAt).toLocaleString()}\n\n⚠️ Verify the link and quantity before approving.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Approve & Start Processing', callback_data: `approve_order_${o._id}` }, { text: '❌ Reject & Refund', callback_data: `reject_order_${o._id}` }]
            ]
          }
        });
      }
      bot.sendMessage(ADMIN_ID, '📋 *End of pending orders*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'main' }]] } });
    }
  }
  else if (data.startsWith('approve_order_')) {
    const id = data.split('_')[2];
    const order = await Order.findById(id);
    order.status = 'processing';
    await order.save();
    
    bot.answerCallbackQuery(query.id, { text: 'Order approved! Now processing.' });
    bot.sendMessage(ADMIN_ID, `✅ *Order #${order._id.toString().slice(-6)} Approved!*\n\nStatus: PROCESSING\n\nWhen you complete the work, click DONE:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '✅ Mark as DONE (Complete Order)', callback_data: `done_order_${id}` }]]
      }
    });
  }
  else if (data.startsWith('done_order_')) {
    const id = data.split('_')[2];
    const order = await Order.findById(id);
    order.status = 'completed';
    await order.save();
    
    bot.answerCallbackQuery(query.id, { text: 'Order completed!' });
    bot.sendMessage(ADMIN_ID, `✅ *Order #${order._id.toString().slice(-6)} COMPLETED!*\n\nService: ${order.serviceName}\nQuantity: ${order.quantity}\nStatus: DONE ✓`, { parse_mode: 'Markdown' });
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
      description: `Refund for Order #${order._id}`,
      balanceAfter: user.balance
    });
    
    bot.answerCallbackQuery(query.id, { text: 'Order rejected! Refund issued.' });
    bot.sendMessage(ADMIN_ID, `❌ *Order #${order._id.toString().slice(-6)} Rejected*\n\n💰 Refunded ₨ ${order.price} to user.\n💳 User's new balance: ₨ ${user.balance}`, { parse_mode: 'Markdown' });
  }
  
  // ============ PROCESSING ORDERS ============
  else if (data === 'orders_processing') {
    const orders = await Order.find({ status: 'processing' }).sort('-createdAt');
    if (orders.length === 0) {
      bot.editMessageText('⚙️ *No processing orders.*', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'main' }]] }
      });
    } else {
      for (let o of orders) {
        const user = await User.findById(o.userId);
        bot.sendMessage(ADMIN_ID, `⚙️ *Processing Order #${o._id.toString().slice(-6)}*\n\n👤 User: ${user.name}\n📋 Service: ${o.serviceName}\n🔢 Quantity: ${o.quantity.toLocaleString()}\n💰 Price: ₨ ${o.price}\n\n✅ Mark as DONE when work is completed.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '✅ Mark as DONE', callback_data: `done_order_${o._id}` }]]
          }
        });
      }
      bot.sendMessage(ADMIN_ID, '📋 *End of processing orders*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'main' }]] } });
    }
  }
  
  // ============ PROMO CODES ============
  else if (data === 'promos') {
    const promos = await PromoCode.find();
    let text = '🎫 *Promo Codes Management*\n\n';
    if (promos.length === 0) {
      text += 'No promo codes created yet.';
    } else {
      for (let p of promos) {
        text += `📌 *${p.code}*: ₨${p.bonusAmount} bonus\n`;
        text += `   Uses: ${p.usedCount}/${p.maxUses || '∞'} | Expires: ${p.expiresAt ? p.expiresAt.toDateString() : 'Never'} | ${p.enabled ? '✅ Active' : '❌ Inactive'}\n\n`;
      }
    }
    
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Create Promo Code', callback_data: 'create_promo' }],
          [{ text: '🔘 Enable/Disable Promo', callback_data: 'toggle_promo' }],
          [{ text: '🗑 Delete Promo Code', callback_data: 'delete_promo' }],
          [{ text: '🔙 Back to Main Menu', callback_data: 'main' }]
        ]
      }
    });
  }
  else if (data === 'create_promo') {
    bot.sendMessage(ADMIN_ID, '🎫 *Create Promo Code*\n\nSend details in format:\n`Code, BonusAmount, MaxUses, ExpiryDate(YYYY-MM-DD)`\n\nExamples:\n`SAVE50, 50, 100, 2026-12-31`\n`WELCOME, 100, 50, never`\n\n(For no expiry, write "never")', { parse_mode: 'Markdown' });
    bot.once('message', async (m) => {
      const parts = m.text.split(',');
      if (parts.length >= 3) {
        const expiresAt = (parts[3] && parts[3].trim() !== 'never') ? new Date(parts[3].trim()) : null;
        await PromoCode.create({
          code: parts[0].trim().toUpperCase(),
          bonusAmount: parseInt(parts[1]),
          maxUses: parseInt(parts[2]),
          expiresAt: expiresAt,
          enabled: true
        });
        bot.sendMessage(ADMIN_ID, `✅ Promo code "${parts[0].trim().toUpperCase()}" created successfully!`);
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
    
    bot.editMessageText('🔘 *Select promo code to enable/disable:*', {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('toggle_promo_')) {
    const id = data.split('_')[2];
    const promo = await PromoCode.findById(id);
    promo.enabled = !promo.enabled;
    await promo.save();
    bot.answerCallbackQuery(query.id, { text: `Promo ${promo.enabled ? 'Enabled' : 'Disabled'}!` });
    bot.sendMessage(ADMIN_ID, `✅ Promo code "${promo.code}" is now ${promo.enabled ? 'ACTIVE' : 'INACTIVE'}`);
  }
  else if (data === 'delete_promo') {
    const promos = await PromoCode.find();
    let buttons = [];
    for (let p of promos) {
      buttons.push([{ text: `🗑 ${p.code}`, callback_data: `delete_promo_${p._id}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'promos' }]);
    
    bot.editMessageText('⚠️ *Select promo code to DELETE:*', {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
  else if (data.startsWith('delete_promo_')) {
    const id = data.split('_')[2];
    const promo = await PromoCode.findById(id);
    await PromoCode.findByIdAndDelete(id);
    bot.answerCallbackQuery(query.id, { text: `Promo "${promo.code}" deleted!` });
    bot.sendMessage(ADMIN_ID, `🗑 Promo code "${promo.code}" has been deleted.`);
  }
  
  // ============ STATISTICS ============
  else if (data === 'stats') {
    const totalUsers = await User.countDocuments();
    const totalOrders = await Order.countDocuments();
    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    const completedOrders = await Order.countDocuments({ status: 'completed' });
    const totalDeposits = await Deposit.countDocuments({ status: 'approved' });
    const totalRevenue = await Order.aggregate([{ $group: { _id: null, total: { $sum: '$price' } } }]);
    
    const text = `📊 *Statistics*\n\n👥 Total Users: ${totalUsers}\n📦 Total Orders: ${totalOrders}\n⏳ Pending Orders: ${pendingOrders}\n✅ Completed Orders: ${completedOrders}\n💰 Approved Deposits: ${totalDeposits}\n💵 Total Revenue: ₨ ${totalRevenue[0]?.total?.toLocaleString() || 0}\n\n📅 Last updated: ${new Date().toLocaleString()}`;
    
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Main Menu', callback_data: 'main' }]] }
    });
  }
  
  // ============ BACK TO MAIN MENU ============
  else if (data === 'main') {
    bot.editMessageText('👑 *Main Menu*\n\nSelect an option to continue:', {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      ...mainMenu
    });
  }
});

// ============ ERROR HANDLING ============
bot.on('error', (err) => {
  console.error('❌ Bot Error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Bot Uncaught Exception:', err);
});

console.log('🤖 Telegram Admin Bot is running...');
console.log(`📱 Bot username: @${(await bot.getMe()).username}`);
