import { Schema, model, Document } from 'mongoose';

export interface ISyncJob extends Document {
    fileName: string;
    totalSKUs: number;
    totalChunks: number;
    chunksProcessed: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    metrics: {
        created: number;
        updated: number;
        failed: number;
    };
    details: Array<{
        chunkIndex: number;
        message: string;
        createdDetails: string[];
        updatedDetails: string[];
        failedDetails: string[];
        status: 'success' | 'error' | 'warning';
        timestamp: Date;
    }>;
    createdAt: Date;
    updatedAt: Date;
}

const SyncJobSchema = new Schema<ISyncJob>({
    fileName: { type: String, required: true },
    totalSKUs: { type: Number, required: true },
    totalChunks: { type: Number, required: true },
    chunksProcessed: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    metrics: {
        created: { type: Number, default: 0 },
        updated: { type: Number, default: 0 },
        failed: { type: Number, default: 0 }
    },
    details: [
        {
            chunkIndex: { type: Number },
            message: { type: String },
            createdDetails: [{ type: String }],
            updatedDetails: [{ type: String }],
            failedDetails: [{ type: String }],
            status: { type: String, enum: ['success', 'error', 'warning'] },
            timestamp: { type: Date, default: Date.now }
        }
    ]
}, {
    timestamps: true
});

export const SyncJob = model<ISyncJob>('SyncJob', SyncJobSchema);
