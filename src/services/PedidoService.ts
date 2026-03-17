import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { Pedido, IPedidoPayload } from '../models/Pedido';
import { Reserva } from '../models/Reserva';
import { Cliente } from '../models/Cliente';
import { getNextCorrelativo } from '../models/Correlativo';
import { logger, io } from '../index';

// SQS client is created lazily inside encolarPedido() so env vars are
// guaranteed to be loaded before the credentials are read.

// ─── Enqueue ─────────────────────────────────────────────────────────────────

export async function encolarPedido(payload: IPedidoPayload, vendedorId: string) {
    const pedido = await Pedido.create({ estado: 'pendiente', payload, vendedorId, creadoEn: new Date() });

    const message = { pedidoId: pedido._id.toString(), ts: Date.now() };

    // Create SQS client lazily so AWS env vars are already loaded by dotenv
    const sqs = new SQSClient({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID_DEV || process.env.AWS_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_DEV || process.env.AWS_SECRET_ACCESS_KEY || '',
        },
    });

    try {
        const out = await sqs.send(new SendMessageCommand({
            QueueUrl: process.env.SQS_PEDIDOS_QUEUE_URL || '',
            MessageBody: JSON.stringify(message),
            MessageGroupId: vendedorId,
            MessageDeduplicationId: pedido._id.toString(),
        }));
        pedido.sqsMessageId = out.MessageId;
        await pedido.save();
        logger.info(`✅ Pedido encolado: ${pedido._id} → SQS msgId: ${out.MessageId}`);
        return pedido;
    } catch (err: any) {
        pedido.estado = 'error';
        pedido.error = String(err);
        await pedido.save();
        throw err;
    }
}

// ─── Stock helpers ────────────────────────────────────────────────────────────

async function actualizarStock(codigo: string, cantidad: number) {
    // Resolve to the local Producto collection (Código field)
    const { Producto } = await import('../models/Producto');
    await Producto.findOneAndUpdate(
        { sku: codigo },
        { $inc: { 'Existencia Actual': -cantidad } }
    );
}

async function cancelarReservas(codigoProducto: string, idUsuario: string) {
    await Reserva.deleteMany({ codigoProducto, idUsuario });
}

// ─── PDF Generator ────────────────────────────────────────────────────────────

function generarPDFBuffer(
    cliente: Record<string, any>,
    productos: IPedidoPayload['productos'],
    total: number,
    correlativo: number,
    vendedor: string,
    hora: string,
    notaCorreo: string
): Promise<{ pdf: Buffer; logo: Buffer | null }> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margins: { top: 28, bottom: 0, left: 28, right: 28 }, size: 'A4' });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('error', reject);

        // ── Load Logo ──
        const logoUrl = "https://toyoxpress.com/wp-content/uploads/2017/07/Ai-LOGO-TOYOXPRESS.png";
        
        const finishPdf = (buffer: Buffer | null) => {
            // ── Header ──
            const startY = 24;
            if (buffer) {
                try {
                    doc.image(buffer, 28, startY, { height: 40 });
                } catch (e) {
                    logger.warn('⚠️ Error al insertar imagen en PDF:', e);
                }
            }

            doc.fontSize(15).font('Helvetica-Bold').fillColor('#0f172a').text('PEDIDO', 0, startY + 5, { align: 'right' });
            doc.fontSize(7.5).font('Helvetica').fillColor('#64748b').text(`Fecha: ${hora || new Date().toLocaleString('es-VE')}`, { align: 'right' });
            doc.text(`Vendedor: ${vendedor}`, { align: 'right' });

            doc.moveTo(28, startY + 52).lineTo(567, startY + 52).lineWidth(1.5).strokeColor('#1a1a1a').stroke();

            // ── Client info ──
            let y = startY + 68;

            const infoRows = [
                ['Razón Social:', cliente.Nombre || ''],
                ['RIF:', cliente.Rif || ''],
                cliente.Telefonos ? ['Teléfono:', cliente.Telefonos] : null,
                cliente['Correo Electronico'] ? ['Correo:', cliente['Correo Electronico']] : null,
                cliente.Ciudad ? ['Ciudad:', cliente.Ciudad] : null,
                cliente['Tipo de Precio'] ? ['Tipo de Precio:', cliente['Tipo de Precio']] : null
            ].filter(Boolean) as [string, string][];

            const boxHeight = 24 + (infoRows.length * 12);

            // Background box
            doc.roundedRect(28, y, 539, boxHeight, 4).fillAndStroke('#f8fafc', '#e2e8f0');
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b').text('DATOS DEL CLIENTE', 36, y + 8);

            let rowY = y + 20;
            for (const [label, val] of infoRows) {
                doc.font('Helvetica').fillColor('#64748b').fontSize(7.5).text(label, 36, rowY, { width: 70 });
                doc.font('Helvetica-Bold').fillColor('#0f172a').text(val, 106, rowY);
                rowY += 12;
            }

            y += boxHeight + 14;

            // ── Products table header ──
            doc.roundedRect(28, y, 539, 16, 3).fill('#0f172a');
            doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
            const thY = y + 5;

            // Column X positions
            const c1 = 32, c2 = 102, c3 = 307, c4 = 382, c5 = 430, c6 = 494;

            doc.text('CÓDIGO', c1, thY);
            doc.text('DESCRIPCIÓN', c2, thY);
            doc.text('MARCA', c3, thY);
            doc.text('CANT.', c4, thY, { width: 48, align: 'center' });
            doc.text('P.U. $', c5, thY, { width: 64, align: 'right' });
            doc.text('TOTAL $', c6, thY, { width: 70, align: 'right' });

            y += 18;

            // ── Product rows ──
            let isEven = false;
            doc.font('Helvetica').fontSize(7.5);

            for (const p of productos) {
                // New page check
                if (y > 750) {
                    doc.addPage();
                    y = 28;
                    isEven = false;
                }

                if (isEven) {
                    doc.rect(28, y, 539, 16).fill('#f8fafc');
                }
                const ty = y + 5;

                doc.fontSize(7).fillColor('#64748b').text(p.codigo, c1, ty, { width: 66, height: 10, lineBreak: false });
                doc.fontSize(7.5).fillColor('#1e293b').text(p.nombre, c2, ty, { width: 200, height: 10, lineBreak: false });
                doc.fontSize(7).fillColor('#64748b').text(p.marca || '—', c3, ty, { width: 70, height: 10, lineBreak: false });
                doc.fontSize(7.5).fillColor('#1e293b').text(String(p.cantidad), c4, ty, { width: 48, align: 'center' });
                doc.text(p.precio.toFixed(2), c5, ty, { width: 64, align: 'right' });
                doc.text(p.total.toFixed(2), c6, ty, { width: 70, align: 'right' });

                y += 16;
                doc.moveTo(28, y).lineTo(567, y).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
                isEven = !isEven;
            }

            y += 10;

            // ── Totals ──
            const totalItems = productos.reduce((s, p) => s + p.cantidad, 0);

            doc.roundedRect(300, y, 80, 24, 4).fill('#f1f5f9');
            doc.fillColor('#64748b').fontSize(6.5).font('Helvetica-Bold').text('LÍNEAS', 300, y + 4, { width: 80, align: 'center' });
            doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(String(productos.length), 300, y + 12, { width: 80, align: 'center' });

            doc.roundedRect(390, y, 80, 24, 4).fill('#f1f5f9');
            doc.fillColor('#64748b').fontSize(6.5).font('Helvetica-Bold').text('ITEMS', 390, y + 4, { width: 80, align: 'center' });
            doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(String(totalItems), 390, y + 12, { width: 80, align: 'center' });

            doc.roundedRect(480, y, 87, 24, 4).fill('#0f172a');
            doc.fillColor('#94a3b8').fontSize(6.5).font('Helvetica-Bold').text('TOTAL', 480, y + 4, { width: 87, align: 'center' });
            doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text('$' + total.toFixed(2), 480, y + 12, { width: 87, align: 'center' });

            y += 34;

            // ── Nota del Pedido ──
            if (notaCorreo) {
                if (y > 720) { doc.addPage(); y = 28; }
                doc.roundedRect(28, y, 539, 40, 3).stroke('#e2e8f0');
                doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text('NOTA DEL PEDIDO', 36, y + 8);
                doc.fillColor('#334155').fontSize(8).font('Helvetica').text(notaCorreo, 36, y + 20, { width: 520, lineGap: 2 });
                y += 54;
            }

            // ── Footer ──
            doc.moveTo(28, 800).lineTo(567, 800).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
            doc.fillColor('#94a3b8').fontSize(6.5).font('Helvetica').text('TOYOXPRESS — Repuestos y Accesorios', 28, 808);
            doc.text(`Documento generado el ${hora}`, 0, 808, { align: 'right' });

            doc.end();
        };

        const axios = require('axios');
        axios.get(logoUrl, { responseType: 'arraybuffer' })
            .then((response: any) => {
                const logo = Buffer.from(response.data);
                doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), logo }));
                finishPdf(logo);
            })
            .catch((err: any) => {
                logger.warn('⚠️ No se pudo descargar el logo para el PDF, continuando sin él:', err.message);
                doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), logo: null }));
                finishPdf(null);
            });
    });
}

// ─── Mailer ───────────────────────────────────────────────────────────────────

async function enviarEmails(pdfBuffer: Buffer, correlativo: number, clienteNombre: string, notaPedido: string, logoBuffer: Buffer | null) {
    if (!process.env.SMTP_HOST) {
        logger.warn('⚠️  SMTP no configurado — email omitido.');
        return;
    }

    const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: 10000, // 10s
        greetingTimeout: 10000,
        socketTimeout: 20000,
        debug: true, // Enable debug in logs
    });

    // ── Verify SMTP connection & auth ─────────────────────────────────────
    try {
        logger.info(`📧 [SMTP] Intentando conectar a ${process.env.SMTP_HOST || 'smtp-relay.brevo.com'}:${process.env.SMTP_PORT || 587}...`);
        await transporter.verify();
        logger.info(`✅ [SMTP] Conexión establecida y autenticada correctamente`);
    } catch (verifyErr: any) {
        logger.error(`❌ [SMTP] Error de autenticación o conexión: ${verifyErr.message}`);
        logger.error(`   → Host: ${process.env.SMTP_HOST}, Puerto: ${process.env.SMTP_PORT}, User: ${process.env.SMTP_USER}`);
        logger.warn('   → TIP: Si el puerto 587 falló, intenta con el 465 y SMTP_SECURE=true en el .env');
        return;
    }

    // Build recipients: strictly EMAIL_CC (do not include client email)
    const fixed = (process.env.EMAIL_CC || 'pedidostoyoxpress@gmail.com,hectorumerez@gmail.com,toyoxpressca@gmail.com')
        .split(',').map(s => s.trim()).filter(Boolean);
    const all = [...new Set(fixed)];

    if (all.length === 0) {
        logger.warn('⚠️  No hay destinatarios EMAIL_CC configurados. Se omite el envío de correo interno.');
        return;
    }

    const subject = `Pedido #${correlativo} — ${clienteNombre}`;

    // Add Nota a Bodega section if it exists
    const notaHtml = notaPedido ? `
        <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 16px; margin-bottom: 24px; border-radius: 0 4px 4px 0;">
            <p style="font-size: 13px; font-weight: 600; color: #a16207; margin: 0 0 4px 0; text-transform: uppercase;">Mensaje a Bodega:</p>
            <p style="font-size: 14px; color: #854d0e; margin: 0;">${notaPedido.replace(/\n/g, '<br>')}</p>
        </div>
    ` : '';

    const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://toyoxpress.com/wp-content/uploads/2017/07/Ai-LOGO-TOYOXPRESS.png" alt="ToyoXpress" style="max-height: 48px; width: auto;">
        </div>
        <p style="font-size: 15px; margin-bottom: 16px;">Hola,</p>
        <p style="font-size: 15px; line-height: 1.5; margin-bottom: 24px;">
            Se ha generado un nuevo pedido en <strong>Toyoxpress.com</strong> para el cliente <strong>${clienteNombre}</strong>.
            Adjuntamos en este correo el archivo PDF con el comprobante completo.
        </p>

        ${notaHtml}

        <p style="font-size: 15px; line-height: 1.5; margin-bottom: 32px;">
            Si tienes alguna duda, puedes responder a este correo o escribirnos a <a href="mailto:contacto@toyoxpress.com" style="color: #2563eb; text-decoration: none;">contacto@toyoxpress.com</a>.
        </p>
        <p style="font-size: 15px; line-height: 1.5; color: #475569;">
            Saludos cordiales,<br>
            Equipo Toyoxpress
        </p>
    </div>
    `;

    for (const to of all) {
        try {
            await transporter.sendMail({
                from: from,
                to,
                subject,
                html,
                attachments: [
                    ...(logoBuffer ? [{
                        filename: 'toyoxpress-logo.png',
                        content: logoBuffer,
                        cid: 'toyoxpress-logo' // inline image referenced in html
                    }] : []),
                    {
                        filename: `Pedido_${correlativo}.pdf`,
                        content: pdfBuffer
                    }
                ],
            });
            logger.info(`📧 Email enviado → ${to}`);
        } catch (e: any) {
            logger.error(`❌ Email falló → ${to}:`, e.message);
        }
    }
}

// ─── Main Worker Pipeline ─────────────────────────────────────────────────────

export async function procesarPedido({ pedidoId }: { pedidoId: string }) {
    // Step 1: Lock the order (prevent double-processing)
    const pedido = await Pedido.findOneAndUpdate(
        { _id: pedidoId, estado: { $in: ['pendiente', 'procesando'] } },
        { estado: 'procesando' },
        { new: true }
    );

    if (!pedido) {
        logger.warn(`[PedidoWorker] Pedido ${pedidoId} no encontrado o ya procesado.`);
        return;
    }

    logger.info(`[PedidoWorker] >>> INICIANDO PROCESAMIENTO: ${pedidoId}`);

    const { cliente, vendedor, productos, total, notaPedido, notaCorreo, emails, hora } = pedido.payload;

    try {
        // Step 2: Atomic correlativo
        const correlativo = await getNextCorrelativo();
        logger.info(`[PedidoWorker] [${pedidoId}] Correlativo asignado: #${correlativo}`);

        logger.info(`[PedidoWorker] [${pedidoId}] Conectando con WooCommerce...`);

        // Step 3: Create order in WooCommerce (proper await — throws on failure)
        const WooCommerce = new WooCommerceRestApi({
            url: process.env.WC_URL || '',
            consumerKey: process.env.WC_CONSUMER_KEY || '',
            consumerSecret: process.env.WC_CONSUMER_SECRET || '',
            version: 'wc/v3',
            queryStringAuth: true,
        });

        // Resolve WooCommerce product IDs from SKU
        const lineItems: any[] = [];
        for (const p of productos) {
            try {
                const res = await WooCommerce.get(`products?sku=${p.codigo}`);
                if (res.data?.length > 0) {
                    lineItems.push({ product_id: res.data[0].id, quantity: p.cantidad });
                }
            } catch { /* skip unresolvable SKUs */ }
        }

        // Email for billing (from cliente + extras)
        const extractEmails = (raw: string) => raw.split(/[\s;,]+/).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
        const clienteEmail = cliente['Correo Electronico'] ? extractEmails(cliente['Correo Electronico'])[0] : '';

        const orderPayload: any = {
            billing: { first_name: cliente.Nombre, email: clienteEmail, phone: cliente.Telefonos, address_1: cliente.Direccion, state: cliente.Estado, city: cliente.Ciudad },
            shipping: { first_name: cliente.Nombre, address_1: cliente.Direccion, state: cliente.Estado, city: cliente.Ciudad },
            line_items: lineItems,
            status: 'pedidoapp',
            customer_note: notaPedido || '',
            meta_data: [{ key: '_numero_pedido_app', value: String(correlativo) }],
        };
        if (cliente['Tipo de Precio'] === 'Precio Oferta') orderPayload.apply_role = 'cliente2';

        // ← If this throws, the catch block marks the order as 'error' and stock is NOT touched
        await WooCommerce.post('orders', orderPayload);
        logger.info(`[PedidoWorker] [${pedidoId}] Orden WooCommerce creada OK (#${correlativo})`);

        logger.info(`[PedidoWorker] [${pedidoId}] Generando PDF...`);

        // Step 4: Generate single PDF buffer (shared for email + archive)
        const { pdf: pdfBuffer, logo: logoBuffer } = await generarPDFBuffer(cliente, productos, total, correlativo, vendedor, hora || new Date().toLocaleString('es-VE'), notaCorreo || '');

        // Step 5: Send emails (Only internal CCs, client email handled by WooCommerce)
        logger.info(`[PedidoWorker] [${pedidoId}] Enviando emails...`);
        await enviarEmails(pdfBuffer, correlativo, cliente.Nombre, notaPedido || '', logoBuffer);
        logger.info(`[PedidoWorker] [${pedidoId}] Emails enviados OK`);

        // Step 6: Decrement stock (only after WooCommerce success)
        logger.info(`[PedidoWorker] [${pedidoId}] Actualizando stock local...`);
        await Promise.all(productos.map(p => actualizarStock(p.codigo, p.cantidad)));

        // Step 7: Cancel reservations
        await Promise.all(productos.map(p => cancelarReservas(p.codigo, vendedor)));

        // Step 8: Finalize
        pedido.estado = 'completado';
        pedido.correlativo = correlativo;
        pedido.procesadoEn = new Date();
        await pedido.save();

        // Notify all connected frontend clients in real time
        io.emit('pedido_completado', {
            pedidoId: pedido._id.toString(),
            correlativo,
            cliente: cliente.Nombre,
            total: pedido.payload.total,
            vendedor: vendedor,
        });

        logger.info(`✅ [PedidoWorker] Pedido ${pedidoId} completado — #${correlativo}`);
        return { ok: true, correlativo };

    } catch (err: any) {
        pedido.estado = 'error';
        pedido.error = err.message || String(err);
        await pedido.save();
        logger.error(`❌ [PedidoWorker] Pedido ${pedidoId} falló:`, err);
        throw err;
    }
}

// ─── Reserva helpers (used by the pedidos controller) ────────────────────────

export async function reservarStock(codigoProducto: string, cantidad: number, idUsuario: string) {
    const reservadaHasta = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await Reserva.create({ codigoProducto, cantidad, reservadaHasta, idUsuario });
}

export async function verificarReservas(codigoProducto: string) {
    return Reserva.find({ codigoProducto, reservadaHasta: { $gt: new Date() } });
}
