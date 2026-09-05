const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// مسار ملف الطلبات
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// دالة قراءة الطلبات
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

// دالة حفظ الطلبات
function saveOrders(orders) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  } catch (error) {
    console.error('خطأ في حفظ الطلبات:', error);
    throw error;
  }
}

// نقطة النهاية لإضافة طلب جديد
app.post('/api/orders', (req, res) => {
  const { product, details, userId, timestamp } = req.body;

  if (!product || !userId) {
    return res.status(400).json({ error: 'المنتج و userId مطلوبان' });
  }

  const orders = readOrders();
  const newOrder = {
    id: orders.length + 1,
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

// نقطة نهاية لاستعراض الطلبات (اختياري، يمكن إزالتها في الإنتاج)
app.get('/api/orders', (req, res) => {
  const orders = readOrders();
  res.json(orders);
});

// نقطة نهاية للصحة (health check)
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// تشغيل الخادم
app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});