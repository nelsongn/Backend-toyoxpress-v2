import fs from 'fs';
import path from 'path';

// 🔥 TRAMPA SÍNCRONA DE ERRORES FATALES 🔥
const crashLogPath = path.join(__dirname, '../crash.log');

// Escribe esto al instante apenas el archivo es leído
fs.writeFileSync(crashLogPath, `\n--- [${new Date().toISOString()}] INTENTO DE ARRANQUE ---\n`, { flag: 'a' });

// Atrapa cualquier error que mate la app y lo escribe a la fuerza
process.on('uncaughtException', (err) => {
    console.error('💥 ERROR FATAL (Exception):', err);
    fs.writeFileSync(crashLogPath, `💥 ERROR FATAL (Exception): ${err.message}\n${err.stack}\n`, { flag: 'a' });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('💥 ERROR FATAL (Rejection):', reason);
    fs.writeFileSync(crashLogPath, `💥 ERROR FATAL (Rejection): ${reason}\n`, { flag: 'a' });
});

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io'; // V2 Centralized WebSockets
import winston from 'winston';
import 'winston-daily-rotate-file';
import dns from 'dns';
import { SyncJob } from './models/SyncJob';

dotenv.config();

// Logger Setup (MUST BE BEFORE DNS LOOKUPS)
export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple(),
        }),
        new winston.transports.DailyRotateFile({
            filename: 'logs/app-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '2d',
            zippedArchive: true,
        })
    ],
});

// DNS Debugging for Hostinger
dns.lookup('google.com', (err, address, family) => {
    if (err) logger.error('❌ [DNS DEBUG] Failed to resolve google.com:', err);
    else logger.info(`✅ [DNS DEBUG] google.com resolved to: ${address} (IPv${family})`);
});

dns.lookup('api.brevo.com', (err, address, family) => {
    if (err) logger.error('❌ [DNS DEBUG] Failed to resolve api.brevo.com:', err);
    else logger.info(`✅ [DNS DEBUG] api.brevo.com resolved to: ${address} (IPv${family})`);
});

const app = express();
app.set('trust proxy', 1); // Confía en el primer proxy (el WAF/CDN de Hostinger)
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;

// Centralized Socket.io instance
export const io = new Server(httpServer, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'], // Solo GET y POST son necesarios para el handshake inicial
        credentials: true
    },
    transports: ['websocket'], // 🚀 CRUCIAL: Desactiva polling para evitar spam de peticiones HTTP
    allowEIO3: false,
    pingTimeout: 60000, // Aumenta el tiempo de espera
    pingInterval: 25000  // Intervalo entre pings
});



// Global Middlewares
app.use(express.json({ limit: '10mb' }));
// Global Middlewares
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Exponer la carpeta assets de forma estática
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Request Logger (Diagnostics)
app.use((req, res, next) => {
    logger.info(`[${req.method}] ${req.originalUrl} - IP: ${req.ip}`);
    next();
});

// Performance Logger Middleware
app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const end = process.hrtime.bigint();
        const ms = Number(end - start) / 1e6;
        if (ms > 300) {
            logger.warn(`[SLOW] ${req.method} ${req.originalUrl} - ${ms.toFixed(2)}ms`);
        }
    });
    next();
});



import movimientoRoutes from './routes/movimientos';
import woocommerceRoutes from './routes/woocommerce';
import cuentaRoutes from './routes/cuentas';
import authRoutes from './routes/auth';
import usuarioRoutes from './routes/usuarios';
import productosRoutes from './routes/productos';
import workerRoutes from './routes/worker';
import clientesRoutes from './routes/clientes';
import pedidosRoutes from './routes/pedidos';
import configuracionRoutes from './routes/configuracion';
import dashboardRoutes from './routes/dashboard';

// API Routes
app.use('/api/movimientos', movimientoRoutes);
app.use('/api/woocommerce', woocommerceRoutes);
app.use('/api/cuentas', cuentaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/worker', workerRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/configuracion', configuracionRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Hello World Route
app.get('/', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'ToyoXpress API V2 is active', version: '2.0.0' });
});

app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'ToyoXpress API V2 Running' });
});


// Websocket Events
io.on('connection', async (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    try {
        const THIRTY_MINUTES_AGO = new Date(Date.now() - 30 * 60 * 1000);
        const TWO_MINUTES_AGO = new Date(Date.now() - 2 * 60 * 1000);

        // ── Layer 1: Bulk-expire jobs older than 30 minutes ────────────────
        await SyncJob.updateMany(
            { status: { $in: ['pending', 'processing'] }, updatedAt: { $lt: THIRTY_MINUTES_AGO } },
            { $set: { status: 'completed' } }
        );

        // ── Layer 2: Expire jobs stuck with no progress for > 2 minutes ───
        // These are jobs where SQS messages were never delivered to this backend
        // (Lambda / tunnel issue). createdAt and updatedAt are the same on creation,
        // so we check both.
        await SyncJob.updateMany(
            {
                status: { $in: ['pending', 'processing'] },
                chunksProcessed: 0,
                createdAt: { $lt: TWO_MINUTES_AGO },
            },
            { $set: { status: 'completed' } }
        );

        // ── Find the most recent genuinely active job ──────────────────────
        const activeJob = await SyncJob.findOne({
            status: { $in: ['pending', 'processing'] },
            updatedAt: { $gte: THIRTY_MINUTES_AGO }
        }).sort({ createdAt: -1 }).lean();

        if (activeJob) {
            // ── Layer 3: chunksProcessed reached totalChunks but status wasn't
            //    updated due to a race condition between save() and emit()
            const isActuallyDone =
                (activeJob as any).totalChunks > 0 &&
                (activeJob as any).chunksProcessed >= (activeJob as any).totalChunks;

            if (isActuallyDone) {
                await SyncJob.findByIdAndUpdate(activeJob._id, { $set: { status: 'completed' } });
                logger.info(`[Socket] Job ${activeJob._id} auto-corregido a completed (todos los chunks procesados).`);
                // Don't send anything — the job is done
            } else {
                // Genuinely in-progress: send current state to the new client
                socket.emit('sync_progress', {
                    jobId: activeJob._id,
                    totalChunks: (activeJob as any).totalChunks,
                    chunksProcessed: (activeJob as any).chunksProcessed,
                    totalSKUs: activeJob.totalSKUs,
                    status: activeJob.status,
                    metrics: activeJob.metrics,
                });
            }
        }
    } catch (e) {
        logger.error("Error sending initial sync state", e);
    }

    socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
    });
});

const MONGO_URI = process.env.MONGO_DEV || 'mongodb://127.0.0.1:27017/toyoxpress';

logger.info(`[DB] Intentando conectar a MongoDB...`);

// 🔥 FIX: 1. Levantar el servidor INMEDIATAMENTE para que Railway no lo mate
httpServer.listen(Number(PORT), '0.0.0.0', () => {
    logger.info(`🚀 [SERVER] API V2 escuchando en puerto ${PORT} en 0.0.0.0`);
});

// 2. Conectar a la base de datos de forma asíncrona sin bloquear el puerto
mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
})
    .then(() => {
        logger.info('✅ [DB] Conectado a MongoDB V2 con éxito');
    })
    .catch((err) => {
        logger.error('❌ [DB] Error crítico al conectar a MongoDB:', err);
    });
