import { Request, Response } from 'express';
import { Movimiento } from '../models/Movimiento';
import { logger, io } from '../index'; // Import global logger and socket

export const createMovimiento = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            usuario,
            id_usuario,
            cuenta,
            movimiento,
            concepto,
            bs = 0,
            zelle = 0,
            efectivo = 0,
            dolares = 0,
            vueltoBs = 0,
            vueltoDolar = 0,
            vueltoEfectivo = 0,
            monto = 0,
            fechaString
        } = req.body;

        // FIX: Optimized ID Generation (No Memory Leak)
        // Avoids fetching all documents into memory. Just counts them.
        const totalCurrentMoves = await Movimiento.estimatedDocumentCount();
        const newId = totalCurrentMoves + 1;

        // Correlativo Logic (E-001 or I-001)
        const padId = String(newId).padStart(4, '0');
        const identificador = `${movimiento === 'egreso' ? 'E' : 'I'}-${padId}`;

        const isCajaChica = cuenta === 'CajaChica';

        const newMovimiento = new Movimiento({
            id: newId,
            id_usuario,
            usuario,
            cuenta,
            movimiento,
            concepto,
            bs: Number(bs),
            zelle: Number(zelle),
            efectivo: Number(efectivo),
            dolares: Number(dolares),
            vueltoBs: Number(vueltoBs),
            vueltoDolar: Number(vueltoDolar),
            vueltoEfectivo: Number(vueltoEfectivo),
            monto: Number(monto),
            identificador,
            fechaString,
            fecha: fechaString ? new Date(fechaString + "T12:00:00Z") : undefined,
            status: isCajaChica ? 'aprobado' : 'pendiente',
            vale: isCajaChica ? identificador : undefined,
            disabled: false
        });

        await newMovimiento.save();

        // Broadcast update via WebSocket correctly
        // Does not use global.shared anti-pattern anymore
        io.emit('movimiento_creado', newMovimiento);

        logger.info(`V2: Movimiento ${newId} created by ${usuario}`);
        res.status(201).json({ success: true, movimiento: newMovimiento });
    } catch (error: any) {
        logger.error('Error creating movimiento V2', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

export const getMovimientos = async (req: Request, res: Response): Promise<void> => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const sortBy = (req.query.sortBy as string) || 'id';
        const sortOrder = (req.query.sortOrder as string) || 'desc';

        // Build Filters
        const query: any = { disabled: { $ne: true } };
        const andConditions: any[] = [];

        // ENFORCE PERMISSIONS (Zero Trust Backend)
        const user = (req as any).user;
        if (user && user.permissions) {
            // SuperAdmin bypass via name check is handled in middleware, but just in case:
            if (user.permissions.verOtrosMovimientos !== true && user.name !== 'admin') {
                // User can only see their own movements
                andConditions.push({ usuario: user.name });
            }
        }

        if (req.query.movimiento) {
            const movType = req.query.movimiento as string;
            if (movType === 'ingreso') {
                andConditions.push({
                    $or: [
                        { movimiento: 'ingreso' },
                        { identificador: { $regex: /^I-/i } }
                    ]
                });
            } else if (movType === 'egreso') {
                andConditions.push({
                    $or: [
                        { movimiento: 'egreso' },
                        { identificador: { $regex: /^E-/i } }
                    ]
                });
            }
        }
        if (req.query.cuenta) query.cuenta = req.query.cuenta;
        if (req.query.vale) query.vale = { $regex: req.query.vale, $options: 'i' };
        if (req.query.concepto) query.concepto = { $regex: req.query.concepto, $options: 'i' };

        if (req.query.usuario) {
            andConditions.push({
                $or: [
                    { usuario: { $regex: req.query.usuario, $options: 'i' } },
                    { name: { $regex: req.query.usuario, $options: 'i' } }
                ]
            });
        }

        if (req.query.status && req.query.status !== 'todos') {
            const statusVal = req.query.status as string;
            if (statusVal === 'verificados' || statusVal === 'Aprove') {
                andConditions.push({ 
                    $or: [
                        { vale: { $exists: true, $nin: ["", null] } },
                        { cuenta: 'CajaChica' }
                    ]
                });
            } else if (statusVal === 'no_verificados' || statusVal === 'Unverified') {
                andConditions.push({ 
                    $and: [
                        { $or: [{ vale: "" }, { vale: { $exists: false } }, { vale: null }] },
                        { cuenta: { $ne: 'CajaChica' } }
                    ]
                });
            }
        }

        if (req.query.tipoPago) {
            const pagoType = req.query.tipoPago as string;
            if (['bs', 'zelle', 'efectivo', 'dolares'].includes(pagoType)) {
                query[pagoType] = { $gt: 0 };
            }
        }

        const queryTotals = { ...query, ...(andConditions.length > 0 ? { $and: andConditions } : {}) };

        if (req.query.fechaInicio || req.query.fechaCierre) {
            const dateQuery: any = {};
            if (req.query.fechaInicio) {
                // Parse "YYYY-MM-DD" reliably as Start of Day UTC
                dateQuery.$gte = new Date(`${req.query.fechaInicio}T00:00:00.000Z`);
            }

            let endDate = new Date();
            if (req.query.fechaCierre) {
                // Parse "YYYY-MM-DD" reliably as End of Day UTC
                endDate = new Date(`${req.query.fechaCierre}T23:59:59.999Z`);
            }
            dateQuery.$lte = endDate;

            andConditions.push({
                $or: [
                    { creado: dateQuery },
                    { fecha: dateQuery }
                ]
            });
        }

        if (andConditions.length > 0) {
            query.$and = andConditions;
        }

        // Efficient pagination with indexes
        const sortObject: any = {};

        let actualSortField = sortBy;
        if (sortBy === 'id') actualSortField = '_id';
        if (sortBy === 'creado') actualSortField = 'fecha';

        sortObject[actualSortField] = sortOrder === 'asc' ? 1 : -1;

        const movimientos = await Movimiento.find(query)
            .sort(sortObject)
            .skip((page - 1) * limit)
            .limit(limit);

        const total = await Movimiento.countDocuments(query); // Used countDocuments because query can be filtered

        // Calculate Totals (Saldo Total, Caja Chica) using aggregate pipeline over ALL documents that match the query
        // Since V1 had string amounts, and V2 has number amounts, we adapt this logic safely.
        // We evaluate BOTH old V1 strings ("identificador" starts with "I") and new V2 "movimiento" equals "ingreso"
        // We evaluate BOTH old V1 strings ("identificador" starts with "I") and new V2 "movimiento" equals "ingreso"
        const isIngresoCond = {
            $or: [
                { $eq: [{ $substr: ["$identificador", 0, 1] }, "I"] },
                { $eq: ["$movimiento", "ingreso"] }
            ]
        };

        const [totalsAggr] = await Movimiento.aggregate([
            { $match: queryTotals },
            {
                $group: {
                    _id: null,
                    saldo_total: {
                        $sum: {
                            $cond: [
                                isIngresoCond, // Si es ingreso
                                {
                                    $cond: [
                                        { $eq: ["$cuenta", "CajaChica"] },
                                        0, // Si es CajaChica, no lo cuenta en saldo_total
                                        { $toDouble: "$monto" }
                                    ]
                                },
                                {
                                    $cond: [
                                        { $eq: ["$cuenta", "CajaChica"] },
                                        0, // Si es CajaChica, no lo cuenta en saldo_total
                                        { $multiply: [{ $toDouble: "$monto" }, -1] } // Si es Egreso logico, restalo
                                    ]
                                }
                            ]
                        }
                    },
                    caja_chica: {
                        $sum: {
                            $cond: [
                                isIngresoCond, // Si es ingreso
                                {
                                    $cond: [
                                        { $eq: ["$cuenta", "CajaChica"] },
                                        { $toDouble: "$monto" }, // Si es CajaChica, sumalo a caja chica
                                        0
                                    ]
                                },
                                {
                                    $cond: [
                                        { $eq: ["$cuenta", "CajaChica"] },
                                        { $multiply: [{ $toDouble: "$monto" }, -1] }, // Si es Egreso CajaChica, restalo
                                        0
                                    ]
                                }
                            ]
                        }
                    }
                }
            }
        ]);

        const saldo_total = totalsAggr ? totalsAggr.saldo_total : 0;
        const caja_chica = totalsAggr ? totalsAggr.caja_chica : 0;
        const totalPages = Math.ceil(total / limit) || 1;

        res.status(200).json({ success: true, total, totalPages, movimientos, saldo_total, caja_chica });
    } catch (error) {
        logger.error('Error fetching movimientos V2', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

export const aprobarMovimiento = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { vale } = req.body;

        const movimiento = await Movimiento.findByIdAndUpdate(
            id,
            { status: 'aprobado', vale },
            { new: true }
        );

        if (!movimiento) {
            res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
            return;
        }

        io.emit('movimiento_actualizado', movimiento);

        logger.info(`V2: Movimiento ${movimiento.identificador || id} aprobado.`);
        res.status(200).json({ success: true, movimiento });
    } catch (error) {
        logger.error('Error approving movimiento V2', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

export const getUsuariosDistintos = async (req: Request, res: Response): Promise<void> => {
    try {
        const usuariosRaw: string[] = await Movimiento.distinct('usuario', { disabled: false });
        const namesRaw: string[] = await Movimiento.distinct('name', { disabled: false });

        const allUsersRaw = [...usuariosRaw, ...namesRaw];

        // Filter out empty strings and nulls, trim whitespace, sort alphabetically
        const usuarios = allUsersRaw
            .filter(u => u && u.trim() !== '')
            .map(u => u.trim())
            .sort((a, b) => a.localeCompare(b));

        // unique filter after trim via Set
        const uniqueUsers = Array.from(new Set(usuarios));

        res.status(200).json({ success: true, count: uniqueUsers.length, usuarios: uniqueUsers });
    } catch (error) {
        logger.error('Error fetching distinct users V2', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

export const updateMovimiento = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const {
            usuario,
            cuenta,
            movimiento,
            concepto,
            bs = 0,
            zelle = 0,
            efectivo = 0,
            dolares = 0,
            vueltoBs = 0,
            vueltoDolar = 0,
            vueltoEfectivo = 0,
            monto = 0,
            fechaString
        } = req.body;

        const updatedData: any = {
            usuario,
            cuenta,
            movimiento,
            concepto,
            bs: Number(bs),
            zelle: Number(zelle),
            efectivo: Number(efectivo),
            dolares: Number(dolares),
            vueltoBs: Number(vueltoBs),
            vueltoDolar: Number(vueltoDolar),
            vueltoEfectivo: Number(vueltoEfectivo),
            monto: Number(monto),
            disabled: false
        };

        if (fechaString) {
            updatedData.fechaString = fechaString;
            updatedData.fecha = new Date(fechaString + "T12:00:00Z");
        }

        const updatedMovimiento = await Movimiento.findByIdAndUpdate(
            id,
            updatedData,
            { new: true }
        );

        if (!updatedMovimiento) {
            res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
            return;
        }

        io.emit('movimiento_actualizado', updatedMovimiento);

        logger.info(`V2: Movimiento ${updatedMovimiento.identificador || id} actualizado por ${usuario}`);
        res.status(200).json({ success: true, movimiento: updatedMovimiento });
    } catch (error) {
        logger.error('Error updating movimiento V2', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

export const deleteMovimiento = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        // Perform soft deletion
        const deletedMovimiento = await Movimiento.findByIdAndUpdate(
            id,
            { disabled: true },
            { new: true }
        );

        if (!deletedMovimiento) {
            res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
            return;
        }

        io.emit('movimiento_eliminado', deletedMovimiento);

        logger.info(`V2: Movimiento ${deletedMovimiento.identificador || id} eliminado.`);
        res.status(200).json({ success: true, message: 'Movimiento eliminado', movimiento: deletedMovimiento });
    } catch (error) {
        logger.error('Error deleting movimiento V2', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};
