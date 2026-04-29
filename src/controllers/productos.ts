import { Request, Response } from "express";
import { startWooCommerceSync } from "../services/SyncService";
import { Producto } from "../models/Producto";
import { SyncJob } from "../models/SyncJob";

// @route   GET /api/productos
// @desc    Obtiene la lista paginada de productos locales
// @access  Privado (requiere permisos de inv)
export const getProducts = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const search = req.query.search as string || "";

        const query: any = {};
        if (search) {
            query.$or = [
                { Nombre: { $regex: search, $options: "i" } },
                { Código: { $regex: search, $options: "i" } },
                { sku: { $regex: search, $options: "i" } },
                { name: { $regex: search, $options: "i" } }
            ];
        }

        const startIndex = (page - 1) * limit;

        const total = await Producto.countDocuments(query);
        const productos = await Producto.find(query)
            .sort({ updatedAt: -1 })
            .skip(startIndex)
            .limit(limit)
            .lean();

        return res.status(200).json({
            success: true,
            count: productos.length,
            total,
            page,
            totalPages: Math.ceil(total / limit),
            data: productos,
        });
    } catch (error: any) {
        console.error("❌ Error en getProducts:", error);
        return res.status(500).json({ success: false, message: "Error al obtener productos locales." });
    }
};

// @route   POST /api/productos/upload
// @desc    Comienza la sincronización de inventario a Mongoose y encola a AWS SQS
// @access  Privado (requiere permisos de inv)
export const uploadProducts = async (req: Request, res: Response) => {
    try {
        const { data, length, nombre } = req.body; // V1 legacy keys (data = arr, length = total, nombre = timestamp/fileName)

        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ success: false, message: "No data provided o el Excel está vacío." });
        }

        const fileName = nombre || "Subida_Automatica_" + new Date().toISOString();

        // El servicio procesa BulkWrite + Paraleliza hacia SQS y devuelve el Tracker (JobID)
        const jobRecord = await startWooCommerceSync(data, fileName);

        return res.status(200).json({
            success: true,
            message: "Múltiples chunks encolados en AWS (SQS) exitosamente.",
            jobId: jobRecord.jobId
        });

    } catch (error: any) {
        console.error("❌ Error en uploadProducts:", error);
        return res.status(500).json({ success: false, message: error.message || "Fallo en el servidor." });
    }
};

// @route   GET /api/productos/last-sync
// @desc    Devuelve el SyncJob más reciente (completado, fallido o en processo) para mostrar historial
// @access  Privado (JWT)
export const getLastSync = async (req: Request, res: Response) => {
    try {
        const lastJob = await SyncJob.findOne()
            .sort({ updatedAt: -1 })
            .lean();

        if (!lastJob) {
            return res.status(404).json({ success: false, message: "No hay trabajos de sincronización registrados." });
        }

        return res.status(200).json({ success: true, data: lastJob });
    } catch (error: any) {
        console.error("❌ Error en getLastSync:", error);
        return res.status(500).json({ success: false, message: "Error al obtener última sincronización." });
    }
};

// @route   GET /api/productos/inventario
// @desc    Inventario con filtros. Soporta paginación opcional (?page=&limit=) para la tabla
//          y export completo (sin page/limit) para PDF/Excel.
// @access  Privado (JWT)
export const getInventario = async (req: Request, res: Response) => {
    try {
        const search = (req.query.search as string || "").trim();
        const marca = (req.query.marca as string || "").trim();
        const soloConStock = req.query.soloConStock === "true";
        const page = req.query.page ? parseInt(req.query.page as string) : null;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : null;

        const query: any = {};

        if (search) {
            query.$or = [
                { Nombre: { $regex: search, $options: "i" } },
                { "Código": { $regex: search, $options: "i" } },
                { name: { $regex: search, $options: "i" } },
                { sku: { $regex: search, $options: "i" } },
            ];
        }
        if (marca) query.Marca = { $regex: `^${marca}$`, $options: "i" };
        if (soloConStock) query["Existencia Actual"] = { $gt: 0 };

        const selectFields = {
            sku: 1, "Código": 1, Nombre: 1, Marca: 1, Ref: 1, Modelo: 1,
            "Existencia Actual": 1, "Precio Minimo": 1, "Precio Mayor": 1, "Precio Oferta": 1,
            name: 1, stock_quantity: 1, price: 1,
        };
        const sortOptions: Record<string, 1 | -1> = { Marca: 1, Nombre: 1 };

        // ── Paginated mode (preview table) ────────────────────────────────
        if (page !== null && limit !== null) {
            const total = await Producto.countDocuments(query);
            const skip = (page - 1) * limit;
            const data = await Producto.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(limit)
                .select(selectFields)
                .lean();

            // Compute brands only on first page to avoid re-running on every page turn
            let marcasDisponibles: string[] = [];
            if (page === 1) {
                const allForBrands = await Producto.find({}).distinct("Marca");
                marcasDisponibles = allForBrands.filter(Boolean).sort();
            }

            return res.status(200).json({
                success: true,
                count: data.length,
                total,
                totalPages: Math.ceil(total / limit),
                page,
                marcasDisponibles,
                data,
            });
        }

        // ── Full export mode (no pagination) ─────────────────────────────
        const data = await Producto.find(query)
            .sort(sortOptions)
            .select(selectFields)
            .lean();

        return res.status(200).json({
            success: true,
            count: data.length,
            data,
        });

    } catch (error: any) {
        console.error("❌ Error en getInventario:", error);
        return res.status(500).json({ success: false, message: "Error al obtener inventario." });
    }
};
