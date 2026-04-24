import { SQSClient, SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import { Producto } from "../models/Producto";
import { SyncJob } from "../models/SyncJob";
import fs from "fs";
import path from "path";
import { logger } from "../index";

// SQS Config will be dynamically generated inside the function to prevent .env hoisting race conditions

// Helper for splitting arrays
const splitToChunks = <T>(array: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};

// Cargar categorías (Reutilizado de V1)
const categoriasPath = path.join(__dirname, "../../utils/codigos_categoria.json");
let categoriasData: any[] = [];
try {
    categoriasData = JSON.parse(fs.readFileSync(categoriasPath, "utf8"));
} catch (error) {
    console.error("Error cargando codigos_categoria.json", error);
}

const normalizarTextoCategoria = (texto: string) => {
    if (!texto) return "";
    return String(texto)
        .trim()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/\s*&\s*/g, "&")
        .replace(/\s+/g, " ")
        .toLowerCase();
};

const buscarCategoriaPorNombre = (nombreMarca: string) => {
    if (!nombreMarca) return null;
    const nombreMarcaNormalizado = normalizarTextoCategoria(nombreMarca);

    // Match exacto
    let categoriaEncontrada = categoriasData.find(
        (cat) => normalizarTextoCategoria(cat.CATEGORIA) === nombreMarcaNormalizado
    );

    // Match parcial
    if (!categoriaEncontrada) {
        categoriaEncontrada = categoriasData.find((cat) => {
            const catNorm = normalizarTextoCategoria(cat.CATEGORIA);
            return catNorm.includes(nombreMarcaNormalizado) || nombreMarcaNormalizado.includes(catNorm);
        });
    }
    return categoriaEncontrada;
};

export const startWooCommerceSync = async (excelData: any[], fileName: string) => {
    if (!excelData || excelData.length === 0) {
        throw new Error("No hay datos para sincronizar.");
    }

    // 1. Transform to WooCommerce standard format with robust fallbacks for different Excel headers
    const rawFormatedProducts = excelData.map((producto: any) => {
        const marcaStr = producto.Marca || "";
        const categoriaEncontrada = buscarCategoriaPorNombre(marcaStr);
        const categories = categoriaEncontrada ? [{ id: categoriaEncontrada["ID WC"] }] : [];

        // Catch possible column names from different Excel templates
        const productName = producto.Producto || producto.Nombre || producto["Nombre Corto"] || producto.name || "Sin Nombre";
        const productSku = producto.Código || producto.Codigo || producto.SKU || producto.sku || "N/A";
        const priceMin = producto["Precio 1"] || producto["Precio Minimo"] || producto.Precio || 0;
        const priceMax = producto["Precio 2"] || producto["Precio Mayor"] || 0;
        const currentStock = producto["Existencia Actual"] || producto.Existencia || producto.Stock || producto.stock_quantity || 0;

        return {
            name: `${productName} ${productSku}`,
            sku: String(productSku),
            price: String(priceMin),
            regular_price: String(priceMin),
            sale_price: "",
            manage_stock: true,
            status: "publish",
            stock_quantity: Number(currentStock),
            attributes: [
                {
                    id: 1,
                    name: "Marca",
                    position: 0,
                    visible: true,
                    variation: false,
                    options: producto.Modelo ? [producto.Modelo] : [],
                },
            ],
            categories: categories,
            meta_data: [
                { key: "cliente 2 price", value: String(priceMax) },
                {
                    key: "festiUserRolePrices",
                    value: `{"cliente2":"${priceMax}","salePrice":{"cliente2":""},"schedule":{"cliente2":{"date_from":"","date_to":""}}}`,
                },
            ],
            // Maintain legacy required fields for the local Mongoose schema
            Nombre: productName,
            Código: String(productSku),
            Modelo: producto.Modelo || "",
            Ref: producto.Referencia || "",
            Marca: marcaStr,
            "Existencia Actual": Number(currentStock),
            "Precio Minimo": Number(priceMin),
            "Precio Mayor": Number(priceMax),
        };
    });

    // 1.5. Filtrar Duplicados Locales del Excel para evitar Race Conditions en WooCommerce
    // Si el Excel tiene el mismo SKU 2 veces, WooCommerce explota si se mandan juntos en un POST batch.
    // Usamos un Map para conservar solo la última versión de cada SKU que aparece en el Excel.
    const skuMap = new Map();
    for (const p of rawFormatedProducts) {
        skuMap.set(p.sku, p);
    }
    const formatedProducts = Array.from(skuMap.values());

    // 2. Local Mongoose UPSERT (BulkWrite) instead of DeleteMany
    const bulkOps = formatedProducts.map((p) => ({
        updateOne: {
            filter: { Código: p.sku }, // Match por Código / SKU
            update: { $set: p },
            upsert: true, // Si no existe, lo crea
        },
    }));

    if (bulkOps.length > 0) {
        await Producto.bulkWrite(bulkOps);
    }

    // 3. Divide into WooCommerce API-friendly max chunks (50)
    const CHUNK_SIZE = 50;
    const chunks = splitToChunks(formatedProducts, CHUNK_SIZE);

    // 4. Create tracking SyncJob
    const job = await SyncJob.create({
        fileName: fileName || "Subida_Manual",
        totalSKUs: formatedProducts.length,
        totalChunks: chunks.length,
        status: "processing",
        metrics: { created: 0, updated: 0, failed: 0 },
    });

    const jobId = job._id.toString();

    const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || "https://sqs.us-east-1.amazonaws.com/465836752361/Productos.fifo";
    const sqsClient = new SQSClient({
        region: process.env.AWS_REGION || "us-east-1",
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
        },
    });

    // 5. Fire everything to SQS leveraging batch sending (10 msgs max per `SendMessageBatch`)
    // Emitting all commands in parallel
    const sqsPromises = [];

    // SQS only allows grouping 10 messages max per `SendMessageBatchCommand`
    const SQS_BATCH_SIZE = 10;
    const sqsBatches = splitToChunks(chunks, SQS_BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < sqsBatches.length; batchIdx++) {
        const currentBatch = sqsBatches[batchIdx]; // Array of up to 10 chunks (where each chunk = 50 skus)

        const entries = currentBatch.map((chunk, indexInBatch) => {
            // absolute index across all chunks
            const absoluteChunkIndex = batchIdx * SQS_BATCH_SIZE + indexInBatch;

            const messageBody = JSON.stringify({
                jobId,
                chunkIndex: absoluteChunkIndex,
                payload: chunk // Up to 50 items
            });

            return {
                Id: `chunk_${absoluteChunkIndex}`,
                MessageBody: messageBody,
                MessageGroupId: "productos_woo_sync", // Fifo constraint: keep them sequentially ordered if we want to bypass deadlocks
                MessageDeduplicationId: `${jobId}_${absoluteChunkIndex}`,
            };
        });

        const command = new SendMessageBatchCommand({
            QueueUrl: SQS_QUEUE_URL,
            Entries: entries,
        });

        logger.info(`🚀 [SQS Dispatch] Enviando Batch #${batchIdx + 1}/${sqsBatches.length} a SQS (${currentBatch.length} chunks encapsulados)...`);
        sqsPromises.push(sqsClient.send(command));
    }

    // Await SQS queues submission (non-blocking for Woo)
    await Promise.all(sqsPromises);
    logger.info(`✅ [SQS Dispatch] SQS Aceptó todos los mensajes del Job ${jobId}. Cola FIFO en proceso.`);

    return { jobId, status: "processing", message: "Enviado exitosamente a SQS en paralelo." };
};
