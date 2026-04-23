# ToyoXpress API v2 - Gestión Centralizada de Inventario y E-commerce

### **Arquitectura Cloud Escalable y Sincronización Asíncrona (AWS)**

Este repositorio contiene el núcleo del backend (API RESTful) para **ToyoXpress**, un sistema empresarial diseñado para centralizar la gestión de inventarios, sucursales y sincronización masiva de productos con e-commerce. Construido con **Node.js (TypeScript)** y desplegado en infraestructura **AWS EC2**, el proyecto resuelve problemas complejos de concurrencia y límites de red mediante el desacoplamiento de servicios.

---

## 🚀 Retos de Ingeniería y Soluciones Aplicadas

El ecosistema e-commerce moderno requiere alta disponibilidad y sincronización en tiempo real sin penalizar el rendimiento del servidor principal. Para lograrlo, se aplicaron metodologías de **Ingeniería de Software** y **Arquitectura de Sistemas**:

* **Sincronización Masiva y Mitigación de Rate-Limiting:** La integración con la API de WooCommerce presenta límites estrictos de peticiones. Se diseñó un `SyncService` que delega las actualizaciones de inventario a colas de mensajería (**AWS SQS**). Esto garantiza que las actualizaciones de precios y stock se procesen de manera segura y escalonada, evitando el bloqueo del servidor por excesos de peticiones.
* **Procesamiento Asíncrono de Tareas Pesadas:** La importación de catálogos masivos de SKUs y la generación de reportes bloqueaban el hilo principal de Node.js. La solución fue implementar una arquitectura orientada a eventos utilizando **AWS Lambda** (Workers) para procesar estas tareas en segundo plano (`src/routes/worker.ts`).
* **Modelado de Datos No Relacional (Bases de Datos):** Uso avanzado de **MongoDB** (Mongoose) para modelar catálogos dinámicos de productos, movimientos históricos de inventario (`Movimiento.ts`), y la trazabilidad de procesos de sincronización (`SyncJob.ts`).
* **Reglas de Negocio Estrictas (Ingeniería de Requisitos):** Implementación de middlewares especializados, como `verificarHorario.ts`, que restringen operativamente ciertas transacciones del personal de sucursal fuera de los horarios comerciales establecidos.

---

## 🛠️ Stack Tecnológico e Infraestructura

* **Framework Core:** Node.js con Express, fuertemente tipado con **TypeScript** para un código predecible y seguro.
* **Base de Datos:** MongoDB (gestión de colecciones complejas y referencias relacionales simuladas para clientes y pedidos).
* **Infraestructura Cloud (AWS):**
  * **AWS EC2:** Despliegue principal de la API asegurando control total sobre el entorno del servidor y configuraciones de red.
  * **AWS SQS:** Gestión de colas de mensajes para el desacoplamiento del tráfico hacia WooCommerce.
  * **AWS Lambda:** Ejecución *serverless* de *workers* para procesamiento de procesos ETL (Extract, Transform, Load).
* **Integraciones de Terceros:** WooCommerce API y servicios transaccionales de correo (Brevo SMTP).
* **CI/CD:** Pipelines de GitHub Actions (`trigger-sync.yml`, `receive-sync.yml`) para la automatización de despliegues y sincronizaciones programadas.

---

## 📦 Características Principales

* **Gestión Omnicanal:** Control de inventarios multialmacén, registrando entradas, salidas, mermas y transferencias entre cuentas/sucursales (`Movimiento.ts`).
* **Motor de Sincronización (SyncEngine):** Monitoreo del estado de sincronización de cada producto (Pendiente, Completado, Fallido) mediante el modelo `SyncJob`, incluyendo scripts de recuperación automática de SKUs fallidos (`getFailedSkus.ts`).
* **Seguridad y Trazabilidad:** Sistema de autenticación basado en JWT con roles de usuario, validación de sesiones y auditoría de quién realizó cada movimiento de caja o producto.
* **Dashboard y Analítica:** Endpoints dedicados (`src/controllers/dashboard.ts`) para la extracción y cálculo de métricas operativas en tiempo real (ventas del día, productos críticos en stock).

---

## ⚙️ Configuración y Despliegue en AWS EC2

### Requisitos Previos
* Node.js 18+
* MongoDB v6+ (Local o Atlas)
* Credenciales de AWS IAM (Permisos para SQS y Lambda)
* Llaves API de WooCommerce

### Instalación Local

1. Clonar el repositorio:
```bash
git clone [https://github.com/mdemedina/backend-toyoxpress-v2.git](https://github.com/mdemedina/backend-toyoxpress-v2.git)
cd backend-toyoxpress-v2
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno (`.env`):
```env
PORT=3000
MONGODB_URI=mongodb+srv://tu-cluster.mongodb.net/toyoxpress
JWT_SECRET=tu_secreto_super_seguro
WOOCOMMERCE_URL=[https://tutienda.com](https://tutienda.com)
WOOCOMMERCE_KEY=ck_tu_llave
WOOCOMMERCE_SECRET=cs_tu_secreto
AWS_ACCESS_KEY_ID=tu_llave_aws
AWS_SECRET_ACCESS_KEY=tu_secreto_aws
AWS_REGION=us-east-1
SQS_QUEUE_URL=[https://sqs.us-east-1.amazonaws.com/](https://sqs.us-east-1.amazonaws.com/)...
```

4. Compilar e Iniciar el servidor:
```bash
npm run build
npm run start
```

### Despliegue en Producción (AWS EC2)
El entorno de producción se ejecuta sobre instancias Linux en EC2. Se recomienda el uso de gestores de procesos como **PM2** o contenerización con **Docker**:
```bash
# Compilar TypeScript
npm run build

# Iniciar con PM2 asegurando el reinicio automático
pm2 start dist/src/index.js --name "toyoxpress-api"
pm2 save
```

---

## 🏗️ Topología del Proyecto

```text
src/
├── controllers/        # Lógica de enrutamiento y respuestas HTTP
├── middleware/         # Interceptores de seguridad, JWT y reglas de negocio operativas
├── models/             # Esquemas de Mongoose (Producto, Pedido, Movimiento, SyncJob)
├── routes/             # Definición de endpoints REST agrupados por entidad
└── services/           # Lógica de negocio pesada (SyncService, PedidoService)
scripts/                # Tareas de mantenimiento, QA y cron jobs (test-smtp, testWooSku)
```
