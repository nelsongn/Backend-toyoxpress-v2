import { Request, Response } from "express";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { SyncJob } from "../models/SyncJob";
import { io, logger } from "../index";

// @route   POST /api/worker/process-products
// @desc    Recibe el payload desde AWS Lambda (SQS) y sincroniza con WooCommerce
// @access  Privado (Worker Key)

const backgroundJobQueue: (() => Promise<void>)[] = [];
const CONCURRENCY_LIMIT = 4;
let activeWorkers = 0;

const processQueueWithConcurrency = async () => {
    // Escapa si la cola está vacía o ya alcanzamos el límite de trabajadores
    if (backgroundJobQueue.length === 0 || activeWorkers >= CONCURRENCY_LIMIT) return;

    // Tomamos la siguiente tarea de la cola
    const task = backgroundJobQueue.shift();
    if (task) {
        activeWorkers++;
        // Ejecutamos la promesa asíncrona sin bloquear el loop principal
        task()
            .catch(err => logger.error("Background task error:", err))
            .finally(() => {
                activeWorkers--;
                // Invocamos recursivamente para procesar el resto de la cola
                setTimeout(processQueueWithConcurrency, 500); // Breathing room for WP
            });

        // Disparamos más trabajadores inmediatamente si la concurrencia lo permite
        processQueueWithConcurrency();
    }
};

export const handleSQSProductMessage = async (req: Request, res: Response) => {
    const { jobId, chunkIndex, payload } = req.body;

    if (!jobId || !payload || !Array.isArray(payload)) {
        return res.status(400).json({ success: false, message: "Invalid payload from SQS." });
    }

    if (!process.env.WC_CONSUMER_KEY || !process.env.WC_CONSUMER_SECRET) {
        logger.error("❌ [Worker] Faltan las credenciales de WooCommerce en el .env (WC_CONSUMER_KEY, etc).");
        return res.status(500).json({ success: false, message: "WooCommerce credentials missing in Backend." });
    }

    // 🔥 CRÍTICO: Responder a SQS INMEDIATAMENTE con 200 OK.
    // Esto salva la conexión TCP de Cloudflare que se corta a los 15 segundos y evita Loop infinito de Retries en AWS.
    res.status(200).json({
        success: true,
        message: "Chunk encolado exitosamente para proceso en segundo plano local.",
        queued: payload.length
    });

    // 🚀 Lógica Asíncrona en Background Procesada Secuencialmente
    backgroundJobQueue.push(async () => {
        try {
            // Initialize WooCommerce API lazily to prevent global app crashes
            const WooCommerce = new WooCommerceRestApi({
                url: process.env.WC_URL || "",
                consumerKey: process.env.WC_CONSUMER_KEY || "",
                consumerSecret: process.env.WC_CONSUMER_SECRET || "",
                version: "wc/v3",
                queryStringAuth: true,
            });

            logger.info(`📦 [Worker - BG] Start chunk #${chunkIndex} para Job ${jobId} (${payload.length} SKUs)`);

            // Limpiar las propiedades exclusivas de MongoDB (Legacy de Excel) para que no ensucien el payload de WooCommerce
            const prunedPayload = payload.map((p: any) => {
                const {
                    Nombre, Código, Modelo, Ref, Marca, "Existencia Actual": exAct,
                    "Precio Minimo": pMin, "Precio Mayor": pMax, _id, createdAt, updatedAt, __v, ...wooSafeProperties
                } = p;
                return wooSafeProperties;
            });

            // Estrategia "Optimistic Upload" con 2 Fases
            const optimisticBatch = { create: prunedPayload, update: [] };
            logger.info(`🚀 [Worker - BG] Fase 1: Intentando Crear ${prunedPayload.length} productos limpios en Woo...`);
            const firstResponse = await WooCommerce.post("products/batch", optimisticBatch);

            const firstData = firstResponse.data;
            const updateArray: any[] = [];

            const createdDetails: string[] = [];
            let updatedDetails: string[] = [];
            const failedDetails: string[] = [];

            // Evaluamos respuestas de la Fase 1
            if (firstData.create) {
                for (let index = 0; index < firstData.create.length; index++) {
                    const res = firstData.create[index];
                    const originalItem = prunedPayload[index];

                    if (res.error) {
                        let recoveredId = null;

                        if (res.error.code === 'product_invalid_sku' && res.error.data?.resource_id) {
                            // Era un duplicado clásico; interceptamos el ID real de WordPress
                            recoveredId = res.error.data.resource_id;
                        } else {
                            // El producto dio error, puede ser un glitch "ya se está procesando" o un SKU inválido sin ID.
                            // Intentamos recuperar el ID de WooCommerce buscando manualmente por SKU.
                            try {
                                logger.info(`[Worker - BG] Recuperando ID para SKU trabado: ${originalItem.sku}`);
                                const checkRes = await WooCommerce.get("products", { sku: originalItem.sku });
                                if (checkRes.data && checkRes.data.length > 0) {
                                    recoveredId = checkRes.data[0].id;
                                    logger.info(`[Worker - BG] ID recuperado activo: ${recoveredId}`);
                                } else {
                                    // Búsqueda en la papelera (trash)
                                    const trashRes = await WooCommerce.get("products", { sku: originalItem.sku, status: "trash" });
                                    if (trashRes.data && trashRes.data.length > 0) {
                                        recoveredId = trashRes.data[0].id;
                                        logger.info(`[Worker - BG] ID recuperado en papelera: ${recoveredId}`);
                                    }
                                }
                            } catch (e: any) {
                                logger.error(`[Worker - BG] Error al recuperar ID para ${originalItem.sku}:`, e.response?.data || e.message);
                            }
                        }

                        if (recoveredId) {
                            originalItem.id = recoveredId;
                            updateArray.push(originalItem);
                        } else {
                            failedDetails.push(`CREATE FAIL [SKU ${originalItem?.sku || '???'}]: ${res.error.message}`);
                        }
                    } else {
                        createdDetails.push(`SKU: ${originalItem?.sku} (${originalItem?.name})`);
                    }
                }
            }

            // Fase 2: Actualizar los que Woocommerce rechazó por ser duplicados
            if (updateArray.length > 0) {
                logger.info(`🚀 [Worker - BG] Fase 2: Sobreescribiendo ${updateArray.length} productos pre-existentes en Woo...`);
                const updateBatch = { create: [], update: updateArray };
                const secondResponse = await WooCommerce.post("products/batch", updateBatch);
                const secondData = secondResponse.data;

                if (secondData.update) {
                    secondData.update.forEach((res: any, index: number) => {
                        if (res.error) {
                            failedDetails.push(`UPDATE FAIL [SKU ${updateArray[index]?.sku || '???'}]: ${res.error.message}`);
                        } else {
                            updatedDetails.push(`SKU: ${updateArray[index]?.sku} (${updateArray[index]?.name})`);
                        }
                    });
                }
            }

            const createdCount = createdDetails.length;
            const updatedCount = updatedDetails.length;
            const failedCount = failedDetails.length;

            // Actualizar SyncJob Local en MongoDB
            const job = await SyncJob.findByIdAndUpdate(
                jobId,
                {
                    $inc: {
                        chunksProcessed: 1,
                        "metrics.created": createdCount,
                        "metrics.updated": updatedCount,
                        "metrics.failed": failedCount
                    },
                    $push: {
                        details: {
                            chunkIndex,
                            message: `WooCommerce Batch processado. C: ${createdCount}, U: ${updatedCount}, F: ${failedCount}`,
                            createdDetails,
                            updatedDetails,
                            failedDetails,
                            status: failedCount > 0 ? 'warning' : 'success',
                            timestamp: new Date()
                        }
                    }
                },
                { new: true, returnDocument: 'after' } // fixed mongoose deprecation warning
            );

            if (!job) {
                logger.error(`❌ [Worker - BG] No se encontró el Job ${jobId} en la base de datos.`);
                return;
            }

            // Verificar si terminamos
            if (job.chunksProcessed >= job.totalChunks) {
                job.status = 'completed';
                await job.save();
                logger.info(`✅ [Worker - BG] Trabajo ${jobId} finalizado completamente (${job.totalChunks} chunks).`);
            }

            // Emitir progreso WebSocket al Frontend
            io.emit('sync_progress', {
                jobId: job._id,
                totalChunks: job.totalChunks,
                chunksProcessed: job.chunksProcessed,
                totalSKUs: job.totalSKUs,
                status: job.status,
                metrics: job.metrics,
                latestChunkInfo: `Chunk #${chunkIndex} processado: C(${createdCount}) U(${updatedCount}) F(${failedCount})`,
                latestChunkDetails: {
                    chunkIndex,
                    createdDetails,
                    updatedDetails,
                    failedDetails
                }
            });

        } catch (error: any) {
            logger.error(`❌ [Worker - BG] Fallo general asíncrono en chunk #${chunkIndex}:`, error.response?.data || error);

            await SyncJob.findByIdAndUpdate(jobId, {
                $push: {
                    details: {
                        chunkIndex,
                        message: "Error de Servidor o WooCommerce Inalcanzable",
                        skus: [error.message],
                        status: 'error',
                        timestamp: new Date()
                    }
                }
            });

            const currentJob = await SyncJob.findById(jobId).lean();
            io.emit('sync_progress', {
                jobId,
                totalChunks: currentJob?.totalChunks || 0,
                chunksProcessed: currentJob?.chunksProcessed || 0,
                totalSKUs: currentJob?.totalSKUs || 0,
                status: currentJob?.status || 'failed',
                metrics: currentJob?.metrics || { created: 0, updated: 0, failed: 0 },
                error: true,
                chunkIndex,
                message: "Un paquete no pudo ser enviado a WooCommerce (Timeout / Caída)."
            });
        }
    });
    processQueueWithConcurrency();
};
