# ERP Cartón MVP

Módulos incluidos: **Clientes**, **Cotizaciones** (con líneas de detalle) y **Órdenes de Producción**, sobre PostgreSQL.

---

## Configuración de base de datos (Supabase — gratis)

1. Crear cuenta en [supabase.com](https://supabase.com) y crear un proyecto nuevo.
2. Ir a **Project Settings → Database → Connection string → URI**.
3. Copiar la URI (empieza con `postgresql://...`).

---

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Crear archivo de variables de entorno
copy .env.example .env
```

Editar `.env` y pegar la URI de Supabase:

```
DATABASE_URL=postgresql://postgres:<tu-password>@db.<proyecto>.supabase.co:5432/postgres
PORT=3000
```

```bash
# 3. Iniciar el servidor (crea las tablas automáticamente)
npm start
```

Abrir en el navegador: [http://localhost:3000](http://localhost:3000)

---

## Flujo de trabajo

1. **Clientes** → registrar clientes con datos fiscales y de contacto.
2. **Cotizaciones** → crear cotización para un cliente, agregar líneas (producto, cantidad, precio). El total se calcula automáticamente.
3. **Aprobar** → al aprobar una cotización se genera automáticamente una **Orden de Producción** con código `OP-YYYY-NNNN`.
4. **Órdenes de Producción** → actualizar el estado: Pendiente → En proceso → Completada.

---

## Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET/POST | `/api/customers` | Listar / crear clientes |
| GET/PUT/DELETE | `/api/customers/:id` | Obtener / editar / borrar cliente |
| GET/POST | `/api/quotations` | Listar / crear cotizaciones |
| GET/PUT/DELETE | `/api/quotations/:id` | Obtener / editar / borrar cotización (solo borrador) |
| POST | `/api/quotations/:id/approve` | Aprobar → crea orden de producción |
| POST | `/api/quotations/:id/reject` | Rechazar cotización |
| GET/POST | `/api/quotations/:id/lines` | Líneas de cotización |
| PUT/DELETE | `/api/quotations/:qId/lines/:lId` | Editar / borrar línea |
| GET | `/api/production-orders` | Listar órdenes |
| GET | `/api/production-orders/:id` | Obtener orden |
| PUT | `/api/production-orders/:id/status` | Actualizar estado |

---

## Stack

- **Backend**: Node.js + Express
- **Base de datos**: PostgreSQL (Supabase / Railway / local)
- **ORM**: node-postgres (`pg`) con queries directas
- **Frontend**: HTML + CSS + JS vanilla (sin frameworks)
