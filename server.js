require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => (req, res, next) => fn(req, res).catch(next);

// ── Clientes ─────────────────────────────────────────────────────────────────

app.get('/api/customers', wrap(async (req, res) => {
  res.json(await db.listCustomers());
}));

app.get('/api/customers/:id', wrap(async (req, res) => {
  const c = await db.getCustomer(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(c);
}));

app.post('/api/customers', wrap(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  res.status(201).json(await db.createCustomer(req.body));
}));

app.put('/api/customers/:id', wrap(async (req, res) => {
  if (!await db.getCustomer(req.params.id))
    return res.status(404).json({ error: 'Cliente no encontrado' });
  const updated = await db.updateCustomer(req.params.id, req.body);
  res.json(updated);
}));

app.delete('/api/customers/:id', wrap(async (req, res) => {
  if (!await db.getCustomer(req.params.id))
    return res.status(404).json({ error: 'Cliente no encontrado' });
  await db.deleteCustomer(req.params.id);
  res.json({ success: true });
}));

// ── Cotizaciones ──────────────────────────────────────────────────────────────

app.get('/api/quotations', wrap(async (req, res) => {
  res.json(await db.listQuotations());
}));

app.get('/api/quotations/:id', wrap(async (req, res) => {
  const q = await db.getQuotation(req.params.id);
  if (!q) return res.status(404).json({ error: 'Cotización no encontrada' });
  const lines = await db.listQuotationLines(req.params.id);
  res.json({ ...q, lines });
}));

app.post('/api/quotations', wrap(async (req, res) => {
  const { customer_id } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'El cliente es obligatorio.' });
  res.status(201).json(await db.createQuotation(req.body));
}));

app.put('/api/quotations/:id', wrap(async (req, res) => {
  const updated = await db.updateQuotation(req.params.id, req.body);
  if (!updated) return res.status(400).json({ error: 'No se puede modificar una cotización que no está en borrador.' });
  res.json(updated);
}));

app.delete('/api/quotations/:id', wrap(async (req, res) => {
  const deleted = await db.deleteQuotation(req.params.id);
  if (!deleted) return res.status(400).json({ error: 'Solo se pueden eliminar cotizaciones en borrador.' });
  res.json({ success: true });
}));

app.post('/api/quotations/:id/approve', wrap(async (req, res) => {
  const result = await db.approveQuotation(req.params.id);
  if (!result) return res.status(400).json({ error: 'No se puede aprobar: no existe o no está en borrador.' });
  res.json(result);
}));

app.post('/api/quotations/:id/reject', wrap(async (req, res) => {
  const result = await db.rejectQuotation(req.params.id);
  if (!result) return res.status(400).json({ error: 'No se puede rechazar: no existe o no está en borrador.' });
  res.json(result);
}));

// ── Líneas de cotización ──────────────────────────────────────────────────────

app.get('/api/quotations/:id/lines', wrap(async (req, res) => {
  res.json(await db.listQuotationLines(req.params.id));
}));

app.post('/api/quotations/:id/lines', wrap(async (req, res) => {
  const { description, quantity, unit_price } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: 'La descripción es obligatoria.' });
  res.status(201).json(await db.createQuotationLine(req.params.id, req.body));
}));

app.put('/api/quotations/:quotationId/lines/:lineId', wrap(async (req, res) => {
  const line = await db.updateQuotationLine(req.params.lineId, req.body);
  if (!line) return res.status(404).json({ error: 'Línea no encontrada.' });
  res.json(line);
}));

app.delete('/api/quotations/:quotationId/lines/:lineId', wrap(async (req, res) => {
  const line = await db.deleteQuotationLine(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Línea no encontrada.' });
  res.json({ success: true });
}));

// ── Órdenes de producción ────────────────────────────────────────────────────

app.get('/api/production-orders', wrap(async (req, res) => {
  res.json(await db.listProductionOrders());
}));

app.get('/api/production-orders/:id', wrap(async (req, res) => {
  const o = await db.getProductionOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
  res.json(o);
}));

app.put('/api/production-orders/:id/status', wrap(async (req, res) => {
  const { status, notes } = req.body;
  const valid = ['pending', 'in_progress', 'completed', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: `Estado inválido. Valores: ${valid.join(', ')}` });
  const order = await db.updateProductionOrderStatus(req.params.id, status, notes);
  if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
  res.json(order);
}));

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
