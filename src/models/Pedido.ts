import mongoose, { Schema, Document } from 'mongoose';

export interface ILineaProducto {
    codigo: string;
    nombre: string;
    marca?: string;
    modelo?: string;
    referencia?: string;
    cantidad: number;
    precio: number;
    total: number;
}

export interface IPedidoPayload {
    cliente: Record<string, any>;   // objeto completo de ExcelClientes/Cliente
    vendedor: string;
    productos: ILineaProducto[];
    total: number;
    items: number;
    notaPedido?: string;
    notaCorreo?: string;
    emails?: string[];
    hora?: string;
}

export interface IPedido extends Document {
    estado: 'pendiente' | 'procesando' | 'completado' | 'error';
    payload: IPedidoPayload;
    correlativo?: number;
    vendedorId: string;
    sqsMessageId?: string;
    error?: string;
    creadoEn: Date;
    procesadoEn?: Date;
}

const LineaProductoSchema = new Schema({
    codigo: { type: String, required: true },
    nombre: { type: String, required: true },
    marca: { type: String },
    modelo: { type: String },
    referencia: { type: String },
    cantidad: { type: Number, required: true },
    precio: { type: Number, required: true },
    total: { type: Number, required: true },
}, { _id: false });

const PedidoSchema = new Schema<IPedido>({
    estado: { type: String, enum: ['pendiente', 'procesando', 'completado', 'error'], default: 'pendiente' },
    payload: { type: Schema.Types.Mixed, required: true },
    correlativo: { type: Number },
    vendedorId: { type: String, required: true, index: true },
    sqsMessageId: { type: String },
    error: { type: String },
    creadoEn: { type: Date, default: Date.now },
    procesadoEn: { type: Date },
}, { timestamps: false });

export const Pedido = mongoose.model<IPedido>('Pedido', PedidoSchema);
