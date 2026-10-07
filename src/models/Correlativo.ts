import mongoose, { Schema, Document } from 'mongoose';

interface ICorrelativo extends Document {
    nombre: string;
    seq: number;
}

const CorrelativoSchema = new Schema<ICorrelativo>({
    nombre: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
});

const CorrelativoModel = mongoose.model<ICorrelativo>('Correlativo', CorrelativoSchema);

/**
 * Atomically increments and returns the next correlativo number.
 * Uses findOneAndUpdate with upsert=true to guarantee no duplicates under concurrency.
 */
export async function getNextCorrelativo(): Promise<number> {
    const doc = await CorrelativoModel.findOneAndUpdate(
        { nombre: 'pedidos' },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', upsert: true }
    );
    return doc.seq;
}

export { CorrelativoModel };
