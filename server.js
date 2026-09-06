const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// إعدادات تسجيل دخول الأدمن (يفضل تغييرها من متغيرات البيئة في Render)
// Settings > Environment > ADMIN_USERNAME / ADMIN_PASSWORD
// ============================================================
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  تحذير: تستخدم بيانات دخول افتراضية للأدمن. من فضلك عيّن ADMIN_USERNAME و ADMIN_PASSWORD في متغيرات البيئة (Environment Variables) على Render.');
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 ساعة
const sessions = new Map(); // token -> expiry timestamp

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// تنظيف الجلسات المنتهية دوريًا
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of sessions.entries()) {
    if (now > expiry) sessions.delete(token);
  }
}, 60 * 60 * 1000);

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies['admin_token'];
  if (!isValidSession(token)) {
    return res.status(401).json({ error: 'غير مصرح لك بالدخول، يرجى تسجيل الدخول' });
  }
  next();
}

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// ملفات البيانات
// ============================================================
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');

function readOrders() {
  try {
    if (!fs.existsSync(ORDERS_FILE)) {
      fs.writeFileSync(ORDERS_FILE, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(ORDERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('خطأ في قراءة الطلبات:', error);
    return [];
  }
}

function saveOrders(orders) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  } catch (error) {
    console.error('خطأ في حفظ الطلبات:', error);
    throw error;
  }
}

function readProducts() {
  try {
    if (!fs.existsSync(PRODUCTS_FILE)) {
      const empty = { tabsConfig: [], products: {} };
      fs.mkdirSync(path.dirname(PRODUCTS_FILE), { recursive: true });
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(empty, null, 2));
      return empty;
    }
    const data = fs.readFileSync(PRODUCTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('خطأ في قراءة المنتجات:', error);
    return { tabsConfig: [], products: {} };
  }
}

function saveProducts(data) {
  try {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('خطأ في حفظ المنتجات:', error);
    throw error;
  }
}

// ============================================================
// نقاط النهاية العامة (بدون تسجيل دخول)
// ============================================================

// المنتجات والأقسام - يستخدمها الموقع الرئيسي لعرض البطاقات
app.get('/api/products', (req, res) => {
  const data = readProducts();
  res.json(data);
});

// إضافة طلب جديد
app.post('/api/orders', (req, res) => {
  const { product, details, userId, timestamp } = req.body;

  if (!product || !userId) {
    return res.status(400).json({ error: 'المنتج و userId مطلوبان' });
  }

  const orders = readOrders();
  const nextId = orders.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0) + 1;
  const newOrder = {
    id: nextId,
    product,
    details: details || '',
    userId,
    timestamp: timestamp || new Date().toISOString(),
    status: 'pending'
  };

  orders.push(newOrder);
  saveOrders(orders);

  res.status(201).json({
    message: 'تم حفظ الطلب بنجاح',
    orderId: newOrder.id,
    order: newOrder
  });
});

// نقطة نهاية للصحة (health check)
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ============================================================
// تسجيل دخول / خروج الأدمن
// ============================================================
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = createSession();
    res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Strict`);
    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
});

app.post('/api/admin/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies['admin_token'];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`);
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies['admin_token'];
  res.json({ authenticated: isValidSession(token) });
});

// ============================================================
// إدارة الطلبات (تتطلب تسجيل دخول)
// ============================================================
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = readOrders();
  res.json(orders.slice().reverse()); // الأحدث أولاً
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const allowedStatus = ['pending', 'completed', 'cancelled'];

  if (!allowedStatus.includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة' });
  }

  const orders = readOrders();
  const order = orders.find(o => String(o.id) === String(id));
  if (!order) {
    return res.status(404).json({ error: 'الطلب غير موجود' });
  }

  order.status = status;
  saveOrders(orders);
  res.json({ success: true, order });
});

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const orders = readOrders();
  const filtered = orders.filter(o => String(o.id) !== String(id));

  if (filtered.length === orders.length) {
    return res.status(404).json({ error: 'الطلب غير موجود' });
  }

  saveOrders(filtered);
  res.json({ success: true });
});

// ============================================================
// إدارة المنتجات والأسعار (تتطلب تسجيل دخول)
// ============================================================

// إرجاع كل بيانات المنتجات للتحرير
app.get('/api/admin/products', requireAdmin, (req, res) => {
  res.json(readProducts());
});

// استبدال منتجات قسم واحد بالكامل
app.put('/api/admin/products/:tabId', requireAdmin, (req, res) => {
  const { tabId } = req.params;
  const { items } = req.body || {};

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items يجب أن تكون مصفوفة' });
  }

  const data = readProducts();
  if (!data.tabsConfig.find(t => t.id === tabId)) {
    return res.status(404).json({ error: 'القسم غير موجود' });
  }

  data.products[tabId] = items;
  saveProducts(data);
  res.json({ success: true });
});

// إضافة قسم (تبويب) جديد
app.post('/api/admin/tabs', requireAdmin, (req, res) => {
  const { id, label, iconUrl } = req.body || {};

  if (!id || !label) {
    return res.status(400).json({ error: 'id و label مطلوبان' });
  }
  if (!/^[a-z0-9_-]+$/i.test(id)) {
    return res.status(400).json({ error: 'المعرف (id) يجب أن يحتوي على أحرف/أرقام إنجليزية فقط' });
  }

  const data = readProducts();
  if (data.tabsConfig.find(t => t.id === id)) {
    return res.status(409).json({ error: 'هذا القسم موجود بالفعل' });
  }

  const icon = iconUrl
    ? `<img src="${iconUrl}" alt="${label}" style="width:133px;height:133px;object-fit:contain;" />`
    : '';

  data.tabsConfig.push({ id, label, icon });
  data.products[id] = [];
  saveProducts(data);
  res.status(201).json({ success: true });
});

// تعديل عنوان/أيقونة قسم موجود
app.put('/api/admin/tabs/:tabId', requireAdmin, (req, res) => {
  const { tabId } = req.params;
  const { label, iconUrl } = req.body || {};

  const data = readProducts();
  const tab = data.tabsConfig.find(t => t.id === tabId);
  if (!tab) {
    return res.status(404).json({ error: 'القسم غير موجود' });
  }

  if (label) tab.label = label;
  if (iconUrl) tab.icon = `<img src="${iconUrl}" alt="${label || tab.label}" style="width:133px;height:133px;object-fit:contain;" />`;

  saveProducts(data);
  res.json({ success: true });
});

// حذف قسم بالكامل
app.delete('/api/admin/tabs/:tabId', requireAdmin, (req, res) => {
  const { tabId } = req.params;
  const data = readProducts();
  const idx = data.tabsConfig.findIndex(t => t.id === tabId);

  if (idx === -1) {
    return res.status(404).json({ error: 'القسم غير موجود' });
  }

  data.tabsConfig.splice(idx, 1);
  delete data.products[tabId];
  saveProducts(data);
  res.json({ success: true });
});

// تشغيل الخادم
app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
  console.log(`🔐 لوحة تحكم الأدمن: /admin.html`);
});
