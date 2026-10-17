import { Request, Response } from 'express';
import { Movimiento } from '../models/Movimiento';
import { Pedido } from '../models/Pedido';
import { Cliente } from '../models/Cliente';
import { Producto } from '../models/Producto';
import { Cuenta } from '../models/Cuenta';
import User from '../models/User';
import { SyncJob } from '../models/SyncJob';
import { fechaCaracas, inicioDiaCaracas, finDiaCaracas } from '../utils/fechas';

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const user = (req as any).user;
        const nombreVendedor = user.name;

        // Permisos
        const esAdminGlobal = user.name === 'admin';
        const puedeVerOtrosMovis = !!user.permissions?.verOtrosMovimientos;
        const puedeVerMovis = !!user.permissions?.verMovimientos;
        const esAdmin = esAdminGlobal || puedeVerOtrosMovis || puedeVerMovis;

        const puedeVerCuentas = esAdminGlobal || !!user.permissions?.configurarCuentas;
        const puedeVerPedidos = esAdminGlobal || !!user.permissions?.verPedidos;

        // 1. Resumen Financiero de Hoy
        // "Hoy" es el día en Caracas, no en el servidor (Railway corre en UTC)
        const hoy = fechaCaracas();

        let movimientosQuery: any = { 
            fecha: { $gte: inicioDiaCaracas(hoy), $lte: finDiaCaracas(hoy) },
            disabled: { $ne: true },
            vale: { $exists: true, $nin: ["", null] }
        };
        // Si no tiene permisos ampliados, solo ve sus propios movimientos y ventas
        if (!esAdminGlobal && !puedeVerOtrosMovis) {
            movimientosQuery.usuario = nombreVendedor;
        }

        const movimientosHoy = await Movimiento.find(movimientosQuery).lean();

        let ingresosHoy = 0;
        let egresosHoy = 0;

        movimientosHoy.forEach(m => {
            if (m.movimiento === 'ingreso') ingresosHoy += Number(m.monto || 0);
            if (m.movimiento === 'egreso') egresosHoy += Number(m.monto || 0);
        });

        // 2. Saldos y Cuentas
        let saldoTotal = 0;
        let desgloseCuentas: any[] = [];

        if (puedeVerCuentas) {
            // Calculate absolute total balance first (Global sum of all movements ever)
            const allMovimientos = await Movimiento.find({ 
                disabled: { $ne: true },
                vale: { $exists: true, $nin: ["", null] }
            }).lean();
            allMovimientos.forEach(m => {
                if (m.movimiento === 'ingreso') saldoTotal += Number(m.monto || 0);
                if (m.movimiento === 'egreso') saldoTotal -= Number(m.monto || 0);
            });

            const cuentas = await Cuenta.find().lean();
            const activeAccountValues = cuentas.map(c => c.value);
            let totalInActiveAccounts = 0;

            // Calculate balances for defined accounts
            for (const c of cuentas) {
                const nombreCuenta = c.label || c.value;
                const accountMovimientos = allMovimientos.filter(m => m.cuenta === c.value);
                
                let accountBalance = 0;
                accountMovimientos.forEach(m => {
                    if (m.movimiento === 'ingreso') accountBalance += Number(m.monto || 0);
                    if (m.movimiento === 'egreso') accountBalance -= Number(m.monto || 0);
                });

                totalInActiveAccounts += accountBalance;
                desgloseCuentas.push({ nombre: nombreCuenta, balance: accountBalance, color: c.color });
            }

            // If there's a difference, it's money in deleted accounts or movements with no account
            const othersBalance = saldoTotal - totalInActiveAccounts;
            if (Math.abs(othersBalance) > 0.01) {
                desgloseCuentas.push({ 
                    nombre: "Otros (Sin asignar)", 
                    balance: othersBalance, 
                    color: "#94a3b8" 
                });
            }
        }

        // 3. Pendientes por Aprobar
        let queryPendientes: any = {
            disabled: { $ne: true },
            $or: [{ vale: "" }, { vale: { $exists: false } }, { vale: null }]
        };

        if (!esAdminGlobal && !puedeVerOtrosMovis) {
            queryPendientes.usuario = nombreVendedor;
        }

        const pendientesAprobar = await Movimiento.countDocuments(queryPendientes);

        // 4. Métricas de Catálogo
        const puedeVerTodosLosClientes = esAdminGlobal || !!user.permissions?.verClientes;
        let clientesQuery: any = {};
        if (!puedeVerTodosLosClientes) {
            const cv = user.vendedor;
            if (cv !== undefined && cv !== null) {
                const padded = cv > 0 && cv <= 9 ? `0${cv}` : `${cv}`;
                const simple = String(cv);
                clientesQuery['Vendedores Codigo'] = { $in: [padded, simple] };
            } else {
                clientesQuery['Vendedores Codigo'] = '__NONE__';
            }
        }

        const totalClientes = await Cliente.countDocuments(clientesQuery);
        const totalProductos = await Producto.countDocuments();

        // 4. Actividad Reciente
        let pedidosQuery: any = {};
        if (!esAdminGlobal) {
            pedidosQuery.vendedorId = user.id;
        }

        let ultimosPedidos: any[] = await Pedido.find(pedidosQuery)
            .sort({ creadoEn: -1 })
            .limit(5)
            .lean();

        // Populate vendedor name for each order
        if (ultimosPedidos.length > 0) {
            const vendedorIds = [...new Set(ultimosPedidos.map(p => p.vendedorId))];
            const vendedores = await User.find({ _id: { $in: vendedorIds } }, 'username').lean();

            // Map the IDs to usernames array
            const vendedorMap: Record<string, string> = {};
            vendedores.forEach(v => {
                vendedorMap[v._id.toString()] = v.username;
            });

            ultimosPedidos = ultimosPedidos.map(p => ({
                ...p,
                vendedorName: vendedorMap[p.vendedorId] || p.vendedorId
            }));
        }

        // Los últimos 5 movimientos registrados, de cualquier fecha (mismos filtros que la caja
        // de hoy, sin el filtro del día: aprobados y, si no tiene permisos ampliados, solo los suyos)
        const { fecha: _soloHoy, ...ultimosQuery } = movimientosQuery;
        let ultimosMovimientos = await Movimiento.find(ultimosQuery)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        // Map for frontend compatibility
        ultimosMovimientos = ultimosMovimientos.map(m => ({
            ...m,
            tipo: m.movimiento,
            referencia: m.concepto || m.identificador || 'Sin Detalle'
        }));

        // 5. Estado real de la sincronización (Lambda que lee las colas SQS).
        // Un pedido que sigue "pendiente"/"procesando" después de 10 min indica que la cola no avanza.
        const ahora = Date.now();
        const hace10Min = new Date(ahora - 10 * 60 * 1000);
        const hace24h = new Date(ahora - 24 * 60 * 60 * 1000);

        const [pedidosAtascados, pedidosConError, ultimoPedidoProcesado, ultimaSync] = await Promise.all([
            Pedido.countDocuments({ estado: { $in: ['pendiente', 'procesando'] }, creadoEn: { $lt: hace10Min } }),
            Pedido.countDocuments({ estado: 'error', creadoEn: { $gte: hace24h } }),
            Pedido.findOne({ estado: 'completado', procesadoEn: { $exists: true } })
                .sort({ procesadoEn: -1 })
                .select('procesadoEn')
                .lean(),
            SyncJob.findOne()
                .sort({ updatedAt: -1 })
                .select('fileName status totalChunks chunksProcessed metrics createdAt updatedAt')
                .lean(),
        ]);

        res.status(200).json({
            ok: true,
            esAdmin: esAdminGlobal || puedeVerOtrosMovis, // Info for Frontend UI mode
            puedeVerCuentas,
            puedeVerMovimientos: esAdmin,
            puedeVerPedidos,
            puedeVerOtrosMovimientos: esAdminGlobal || puedeVerOtrosMovis,
            financiero: {
                ingresosHoy,
                egresosHoy,
                saldoTotal
            },
            catalogo: {
                totalClientes,
                totalProductos
            },
            pendientesAprobar,
            cuentas: desgloseCuentas,
            sincronizacion: {
                pedidos: {
                    atascados: pedidosAtascados,
                    conError24h: pedidosConError,
                    ultimoProcesadoEn: ultimoPedidoProcesado?.procesadoEn ?? null,
                },
                productos: ultimaSync ? {
                    archivo: ultimaSync.fileName,
                    estado: ultimaSync.status,
                    lotesProcesados: ultimaSync.chunksProcessed,
                    lotesTotales: ultimaSync.totalChunks,
                    creados: ultimaSync.metrics?.created ?? 0,
                    actualizados: ultimaSync.metrics?.updated ?? 0,
                    fallidos: ultimaSync.metrics?.failed ?? 0,
                    iniciadaEn: ultimaSync.createdAt,
                    actualizadaEn: ultimaSync.updatedAt,
                } : null,
            },
            recientes: {
                pedidos: puedeVerPedidos ? ultimosPedidos : [],
                movimientos: ultimosMovimientos
            }
        });
    } catch (error: any) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({ ok: false, message: 'Server error loading dashboard stats' });
    }
};
