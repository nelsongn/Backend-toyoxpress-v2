import mongoose, { Schema, Document } from 'mongoose';

export interface IMovimiento extends Document {
    id: number;
    creado: Date;
    id_usuario: string;
    usuario: string;
    name?: string; // Legacy V1 field
    cuenta: string;
    movimiento: 'ingreso' | 'egreso';
    concepto: string;
    bs: number;
    change: number; // Exchange rate (Valor de cambio)
    zelle: number;
    efectivo: number;
    dolares: number;
    otro: number; // Otro metodo de pago
    vueltoBs: number;
    vueltoDolar: number;
    vueltoEfectivo: number;
    monto: number;
    fechaString: string;
    fecha?: Date;
    status: string;
    identificador?: string;
    vale?: string;
    usuario_modifico?: string;
    id_usuario_modifico?: string;
}

const MovimientoSchema: Schema = new Schema({
    id: { type: Number, required: true },
    creado: { type: Date, default: Date.now }, // Fixed date bug
    id_usuario: { type: String, required: true },
    usuario: { type: String, required: true },
    name: { type: String }, // Legacy V1
    cuenta: { type: String, required: true },
    movimiento: { type: String, enum: ['ingreso', 'egreso'], required: true },
    concepto: { type: String, required: true },

    // Refactored to Numbers to prevent string issues
    bs: { type: Number, default: 0 },
    change: { type: Number, default: 0 },
    zelle: { type: Number, default: 0 },
    efectivo: { type: Number, default: 0 },
    dolares: { type: Number, default: 0 },
    otro: { type: Number, default: 0 },
    vueltoBs: { type: Number, default: 0 },
    vueltoDolar: { type: Number, default: 0 },
    vueltoEfectivo: { type: Number, default: 0 },
    monto: { type: Number, default: 0 },

    fechaString: { type: String }, // Store formatted string if needed for legacy compatibility
    fecha: { type: Date }, // Legacy explicit date field
    status: { type: String, default: 'completado' },
    identificador: { type: String },
    vale: { type: String },
    usuario_modifico: { type: String },
    id_usuario_modifico: { type: String },
    disabled: { type: Boolean, default: false }
}, {
    timestamps: true // Adds createdAt and updatedAt automatically
});

// Avoid OverwriteModelError in hot reloads
export const Movimiento = mongoose.models.Movimiento || mongoose.model<IMovimiento>('Movimiento', MovimientoSchema, 'movimientos');
