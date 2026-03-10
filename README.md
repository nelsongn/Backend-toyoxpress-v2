# ToyoXpress API v2 🚀

Backend robusto desarrollado en **TypeScript** y **Node.js** para la gestión centralizada de inventarios y pedidos, integrando sistemas locales con la plataforma e-commerce WooCommerce.

## 🛠️ Retos Técnicos y Soluciones
- **Sincronización Masiva:** Implementación de un `SyncService` avanzado que gestiona la actualización de productos hacia WooCommerce evitando bloqueos por rate-limiting de la API.
- **Gestión de Jobs:** Uso de un sistema de "Workers" para procesar tareas pesadas en segundo plano (importación de SKUs, generación de reportes).
- **Integración de Datos:** Procesamiento de archivos Excel y generación de documentos PDF dinámicos para la gestión de ventas.

## 🧰 Stack Tecnológico
- **Runtime:** Node.js v18+
- **Lenguaje:** TypeScript
- **Framework:** Express.js
- **Base de Datos:** MongoDB (Mongoose)
- **Autenticación:** JWT (JSON Web Tokens)
- **Integraciones:** WooCommerce REST API

## 📋 Características Principales
- Auth Middleware personalizado para control de acceso.
- Modelado de datos para pedidos, movimientos de inventario y clientes.
- Scripts de mantenimiento para limpieza de transientes y corrección de SKUs fallidos.

---
*Nota de autor: Este proyecto refleja mi transición hacia arquitecturas más escalables, priorizando el tipado fuerte y la separación de lógica en servicios.*
